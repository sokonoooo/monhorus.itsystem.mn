import mongoose from 'mongoose';

import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

if (!env.isProduction) {
  mongoose.set('debug', false);
}

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (error: unknown) =>
    logger.error({ err: error }, 'MongoDB connection error'),
  );

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    autoIndex: !env.isProduction, // In production, build indexes via a migration.
  });

  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close(false);
  logger.info('MongoDB connection closed');
}
