import { Router, Response } from 'express';
import { prisma } from '../utils/prismaClient';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// Helper to generate a unique random classroom code
function generateClassroomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude confusing chars like 0, O, 1, I
  let code = 'CL-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const CreateClassroomSchema = z.object({
  name: z.string().min(1).max(100),
});

const JoinClassroomSchema = z.object({
  code: z.string().min(1),
});

/**
 * POST /api/classrooms — create a new classroom (professor only)
 */
router.post(
  '/',
  requireAuth,
  requireRole('PROFESSOR'),
  async (req: AuthRequest, res: Response) => {
    const body = CreateClassroomSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }

    try {
      let code = generateClassroomCode();
      let attempts = 0;
      while (attempts < 10) {
        const dupe = await prisma.classroom.findUnique({ where: { code } });
        if (!dupe) break;
        code = generateClassroomCode();
        attempts++;
      }

      const classroom = await prisma.classroom.create({
        data: {
          name: body.data.name,
          code,
          teacherId: req.user!.id,
        },
      });

      res.status(201).json({ classroom });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error creating classroom' });
    }
  }
);

/**
 * GET /api/classrooms — list classrooms
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role === 'PROFESSOR') {
      const classrooms = await prisma.classroom.findMany({
        where: { teacherId: req.user!.id },
        include: {
          _count: {
            select: { students: true, exams: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ classrooms });
    } else {
      const classrooms = await prisma.classroom.findMany({
        where: {
          students: {
            some: {
              studentId: req.user!.id,
            },
          },
        },
        include: {
          teacher: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { students: true, exams: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ classrooms });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching classrooms' });
  }
});

/**
 * POST /api/classrooms/join — join classroom (student only)
 */
router.post(
  '/join',
  requireAuth,
  requireRole('STUDENT'),
  async (req: AuthRequest, res: Response) => {
    const body = JoinClassroomSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() });
      return;
    }

    const code = String(body.data.code).toUpperCase().trim();

    try {
      const classroom = await prisma.classroom.findUnique({
        where: { code },
      });

      if (!classroom) {
        res.status(404).json({ error: 'Classroom not found. Please verify the code.' });
        return;
      }

      // Check if already enrolled
      const existing = await prisma.classroomStudent.findUnique({
        where: {
          classroomId_studentId: {
            classroomId: classroom.id,
            studentId: req.user!.id,
          },
        },
      });

      if (!existing) {
        await prisma.classroomStudent.create({
          data: {
            classroomId: classroom.id,
            studentId: req.user!.id,
          },
        });
      }

      res.json({ success: true, classroom });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error joining classroom' });
    }
  }
);

/**
 * GET /api/classrooms/:id — get classroom E2E details & rankings
 */
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const classroom = await prisma.classroom.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        students: {
          include: {
            student: { select: { id: true, name: true, email: true } },
          },
        },
        exams: {
          include: {
            exam: true,
          },
        },
      },
    });

    if (!classroom) {
      res.status(404).json({ error: 'Classroom not found' });
      return;
    }

    const isTeacher = req.user!.role === 'PROFESSOR' && classroom.teacherId === req.user!.id;
    const isEnrolledStudent = classroom.students.some((s) => s.studentId === req.user!.id);

    if (!isTeacher && !isEnrolledStudent) {
      res.status(403).json({ error: 'Access denied to this classroom' });
      return;
    }

    // Load active/submitted sessions associated with this classroom
    const sessions = await prisma.session.findMany({
      where: { classroomId: id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        exam: { select: { id: true, title: true, duration: true } },
        events: {
          where: { type: 'exam_submitted' },
          take: 1,
        },
        flags: true,
      },
      orderBy: { startedAt: 'asc' }, // default sorted by order in time they gave exam
    });

    // Format E2E submissions payload
    const formattedSessions = sessions.map((s) => {
      let score: number | undefined;
      let maxPoints: number | undefined;

      if (s.events.length > 0) {
        try {
          const payload = JSON.parse(s.events[0].payloadJson);
          score = payload.score;
          maxPoints = payload.maxPoints;
        } catch {}
      }

      // Teacher gets full proctoring metadata (trust score, warnings, flags)
      if (isTeacher) {
        return {
          id: s.id,
          studentName: s.user.name,
          studentEmail: s.user.email,
          examId: s.exam.id,
          examTitle: s.exam.title,
          status: s.status,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          score,
          maxPoints,
          flags: s.flags.map((f) => ({
            id: f.id,
            ruleId: f.ruleId,
            severity: f.severity,
            notes: f.notes,
            createdAt: f.createdAt,
          })),
        };
      } else {
        // Students ONLY get names and marks for rankings (hiding trust scores and warnings)
        return {
          id: s.id,
          studentName: s.user.name,
          examId: s.exam.id,
          examTitle: s.exam.title,
          status: s.status,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          score,
          maxPoints,
        };
      }
    });

    res.json({
      classroom: {
        id: classroom.id,
        name: classroom.name,
        code: classroom.code,
        teacher: classroom.teacher,
        students: classroom.students.map((s) => ({
          id: s.student.id,
          name: s.student.name,
          email: isTeacher ? s.student.email : undefined, // hide email for students
        })),
        exams: classroom.exams.map((ce) => ce.exam),
      },
      submissions: formattedSessions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching classroom details' });
  }
});

export default router;
