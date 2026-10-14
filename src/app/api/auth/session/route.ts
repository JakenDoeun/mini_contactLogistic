import { json, withSession } from '@/server/auth/guard';

export const GET = withSession((_req, user) => json({ username: user.username }));
