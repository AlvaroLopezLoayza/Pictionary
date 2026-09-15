import { z } from 'zod';

export const registerSchema = z.object({
  eventToken: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(20).regex(/^[\p{L}\p{N} _.-]+$/u),
  avatarId: z.number().int().min(0).max(11),
});
export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const guessSchema = z.object({ answer: z.string().trim().min(1).max(80) });
export const teamSchema = z.object({ playerId: z.string().uuid(), teamId: z.enum(['A', 'B']).nullable() });
export const playerIdSchema = z.object({ playerId: z.string().uuid() });
export const lobbySchema = z.object({ open: z.boolean() });
export const wordSchema = z.object({
  id: z.string().uuid().optional(),
  word: z.string().trim().min(2).max(80).regex(/^[\p{L}][\p{L} -]*$/u),
  aliases: z.array(z.string().trim().min(2).max(80).regex(/^[\p{L}][\p{L} -]*$/u)).max(12),
  difficulty: z.enum(['easy', 'hard']),
  enabled: z.boolean(),
});
export const wordUpdateSchema = z.object({ id: z.string().uuid(), value: wordSchema.omit({ id: true }) });
export const wordIdSchema = z.object({ id: z.string().uuid() });
export const csvSchema = z.object({ csv: z.string().min(1).max(1_000_000) });
export const strokeStartSchema = z.object({ id: z.string().uuid() });
export const pointsSchema = z.object({
  id: z.string().uuid(),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64),
});
