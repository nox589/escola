import { createMockPortal } from './app.js';

const port = Number(process.env.MOCK_PORTAL_PORT ?? 4010);
const { app } = createMockPortal();
app.listen(port, () =>
  process.stdout.write(`mock portal on http://localhost:${port} (login parent1 / escola123)\n`),
);
