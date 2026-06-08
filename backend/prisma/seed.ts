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

  console.log(`✅ Created professor: ${professor.email}`);
  console.log(`✅ Created student: ${student.email}`);
  console.log('🎉 Seeding complete!');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
