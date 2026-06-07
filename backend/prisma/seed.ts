import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  const professor = await prisma.user.upsert({
    where: { email: 'professor@university.edu' },
    update: {},
    create: {
      googleId: 'google-prof-seed-id-001',
      name: 'Professor Smith',
      email: 'professor@university.edu',
      role: 'PROFESSOR',
    },
  });

  const student = await prisma.user.upsert({
    where: { email: 'student@university.edu' },
    update: {},
    create: {
      googleId: 'google-student-seed-id-001',
      name: 'Alice Johnson',
      email: 'student@university.edu',
      role: 'STUDENT',
    },
  });

  const examConfig = {
    policy: {
      lowSeverityAction: 'warn',
      mediumSeverityAction: 'warn',
      highSeverityAction: 'submit',
    },
    questions: [
      {
        id: 'q1',
        type: 'multiple_choice',
        text: 'What is the time complexity of binary search?',
        options: ['O(n)', 'O(n log n)', 'O(log n)', 'O(1)'],
        answer: 2,
        points: 10,
      },
      {
        id: 'q2',
        type: 'multiple_choice',
        text: 'Which data structure uses LIFO ordering?',
        options: ['Queue', 'Stack', 'Linked List', 'Tree'],
        answer: 1,
        points: 10,
      },
      {
        id: 'q3',
        type: 'short_answer',
        text: 'Explain the difference between a process and a thread.',
        points: 20,
      },
    ],
    totalPoints: 40,
    allowedResources: 'none',
    webcamRequired: false,
  };

  const exam = await prisma.exam.create({
    data: {
      ownerId: professor.id,
      title: 'Introduction to Computer Science - Midterm',
      duration: 90,
      isActive: true,
      configJson: JSON.stringify(examConfig),
    },
  });

  console.log(`✅ Created professor: ${professor.email}`);
  console.log(`✅ Created student: ${student.email}`);
  console.log(`✅ Created exam: "${exam.title}" (ID: ${exam.id})`);
  console.log('🎉 Seeding complete!');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
