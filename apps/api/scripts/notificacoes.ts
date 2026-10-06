import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { NotificationsService } from '../src/notifications/notifications.service';

const POLL_MS = 1_000;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const worker = app.get(NotificationsService);
  let running = true;
  const stop = () => {
    running = false;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    while (running) {
      const processed = await worker.processOne();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    await app.close();
  }
}

void main();
