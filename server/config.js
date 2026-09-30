const PACE = process.env.PACE || 'normal'; // 'fast' compresses every delay — for demos and tests
export const CFG = {
  fast: PACE === 'fast',
  dev: process.env.DEV === '1', // dev: skip movement validation (screenshots, tests)
  port: Number(process.env.PORT || 8080),
  maxPlayers: Number(process.env.MAX_PLAYERS || 200),
  chargeRegenMs: 55000, plankRegenMs: 18000, signRegenMs: 40000,
  fuseMs: 4200,
};
