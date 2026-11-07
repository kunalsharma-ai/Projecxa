import 'dotenv/config';

// Tests always run against the dedicated test database, never the dev one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://projexa:projexa@localhost:5432/projexa_test';
process.env.CALLBACK_WORKER_ENABLED = 'false';
process.env.PUBLIC_BASE_URL = 'http://api.samptrek.test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.REPORT_SCHEDULER_ENABLED = 'false';
process.env.REDIRECT_SCHEDULER_ENABLED = 'false';
process.env.ZOHO_BOOKS_SCHEDULER_ENABLED = 'false';
process.env.PRIVACY_SCHEDULER_ENABLED = 'false';
process.env.AUTOMATION_SCHEDULER_ENABLED = 'false';
process.env.PUSH_SCHEDULER_ENABLED = 'false';
