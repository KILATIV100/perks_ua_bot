/**
 * Weekly User Export Script
 *
 * Exports all users to a JSON file for backup purposes.
 * Run via: npx ts-node scripts/export-users.ts
 *
 * Can be scheduled with cron:
 * 0 0 * * 0 cd /path/to/server && npx ts-node scripts/export-users.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface ExportedUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  points: number;
  totalSpins: number;
  role: string;
  createdAt: string;
  updatedAt: string;
}

async function exportUsers(): Promise<void> {
  console.log('🔄 Starting user export...');

  try {
    // Fetch all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        points: true,
        totalSpins: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Convert BigInt to string for JSON serialization
    const exportData: ExportedUser[] = users.map((user) => ({
      ...user,
      telegramId: user.telegramId.toString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }));

    // Create exports directory if it doesn't exist
    const exportsDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `users-export-${timestamp}.json`;
    const filepath = path.join(exportsDir, filename);

    // Write to file
    const exportObject = {
      exportedAt: new Date().toISOString(),
      totalUsers: exportData.length,
      users: exportData,
    };

    fs.writeFileSync(filepath, JSON.stringify(exportObject, null, 2), 'utf-8');

    console.log(`✅ Export completed!`);
    console.log(`📁 File: ${filepath}`);
    console.log(`👥 Total users: ${exportData.length}`);

    // Also output to stdout for piping
    console.log('\n--- Export Summary ---');
    console.log(`Total users: ${exportData.length}`);
    console.log(`Total points in circulation: ${exportData.reduce((sum, u) => sum + u.points, 0)}`);
    console.log(`Total spins: ${exportData.reduce((sum, u) => sum + u.totalSpins, 0)}`);

    // Keep only last 4 exports (4 weeks)
    const files = fs.readdirSync(exportsDir)
      .filter(f => f.startsWith('users-export-'))
      .sort()
      .reverse();

    if (files.length > 4) {
      const filesToDelete = files.slice(4);
      for (const file of filesToDelete) {
        fs.unlinkSync(path.join(exportsDir, file));
        console.log(`🗑️ Deleted old export: ${file}`);
      }
    }

  } catch (error) {
    console.error('❌ Export failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run export
exportUsers();
