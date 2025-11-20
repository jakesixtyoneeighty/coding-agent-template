#!/usr/bin/env node

/**
 * Database Migration Script
 *
 * This script runs database migrations using Drizzle ORM's migrate function.
 * It can be used in any environment (development, preview, production).
 *
 * Usage:
 *   npm run db:migrate       - Run using drizzle-kit CLI
 *   tsx scripts/migrate.ts   - Run programmatically
 */

import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// Load environment variables from .env file
config()

async function runMigrations() {
  console.log('→ Running database migrations...')

  // Verify required environment variable
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL environment variable is required')
  }

  // Create a migration client
  // { max: 1 } is recommended for migrations to avoid connection pool issues
  const migrationClient = postgres(process.env.POSTGRES_URL, { max: 1 })

  try {
    // Run migrations
    await migrate(drizzle(migrationClient), {
      migrationsFolder: './lib/db/migrations',
    })

    console.log('✓ Database migrations completed successfully')
  } catch (error) {
    console.error('✗ Migration failed:', error)
    throw error
  } finally {
    // Close the connection
    await migrationClient.end()
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('✓ Migration script completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('✗ Migration script failed:', error)
      process.exit(1)
    })
}

export { runMigrations }
