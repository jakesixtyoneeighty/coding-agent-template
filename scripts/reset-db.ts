#!/usr/bin/env node

/**
 * Database Reset Script
 *
 * Drops all tables and re-runs migrations from scratch.
 * Use this for development when you need a clean slate.
 */

import { config } from 'dotenv'
import postgres from 'postgres'

// Load environment variables
config()

async function resetDatabase() {
  console.log('→ Resetting database...')

  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL environment variable is required')
  }

  const sql = postgres(process.env.POSTGRES_URL, { max: 1 })

  try {
    // Drop all tables
    console.log('  Dropping all tables...')
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`
    await sql`DROP TABLE IF EXISTS anonymous_chat_logs CASCADE`
    await sql`DROP TABLE IF EXISTS chat_ownerships CASCADE`
    await sql`DROP TABLE IF EXISTS accounts CASCADE`
    await sql`DROP TABLE IF EXISTS connectors CASCADE`
    await sql`DROP TABLE IF EXISTS keys CASCADE`
    await sql`DROP TABLE IF EXISTS settings CASCADE`
    await sql`DROP TABLE IF EXISTS task_messages CASCADE`
    await sql`DROP TABLE IF EXISTS tasks CASCADE`
    await sql`DROP TABLE IF EXISTS users CASCADE`
    await sql`DROP TABLE IF EXISTS __drizzle_migrations CASCADE`

    console.log('✓ Database reset completed')
  } catch (error) {
    console.error('✗ Database reset failed:', error)
    throw error
  } finally {
    await sql.end()
  }
}

if (require.main === module) {
  resetDatabase()
    .then(() => {
      console.log('✓ Now run: pnpm db:migrate:run')
      process.exit(0)
    })
    .catch((error) => {
      console.error('✗ Reset failed:', error)
      process.exit(1)
    })
}

export { resetDatabase }
