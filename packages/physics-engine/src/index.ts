import Matter from "matter-js";

type SimulationBody = {
  id: string;
  label: "player" | "ai" | "floor" | "shield" | "bullet";
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  vertices: { x: number; y: number }[];
  /** Set when label is "bullet"; used for damage (no friendly fire). */
  bulletOwner?: "player" | "ai";
  /** Bullet damage multiplier (lens); default 1. */
  damageMul?: number;
};

type ShieldSpec = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
};

type SimulationConfig = {
  halfWidth: number;
  halfHeight: number;
  squareSize: number;
  player: { x: number; y: number; angle: number };
  ai: { x: number; y: number; angle: number };
  shields?: ShieldSpec[];
  frictionAir?: number;
};

type SimulationApi = {
  step: (deltaMs: number) => void;
  getBodies: () => SimulationBody[];
  applyForce: (bodyId: string, fx: number, fy: number) => void;
  setAngularVelocity: (bodyId: string, w: number) => void;
  setAngle: (bodyId: string, angle: number) => void;
  /** Static cube (player-placed; fixed in world). Returns body id or "". */
  placeCube: (x: number, y: number, side: number) => string;
  spawnBullet: (
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    owner: "player" | "ai"
  ) => string;
  removeBullet: (id: string) => void;
  /** Player-placed cube: after "cure" it collides like map walls (actors + bullets). */
  hardenPlacedCube: (bodyId: string) => void;
  setBulletVelocity: (id: string, vx: number, vy: number) => void;
  setBulletPosition: (id: string, x: number, y: number) => void;
  setBulletDamageMul: (id: string, mul: number) => void;
  destroy: () => void;
};

/** Arena walls + map shields + cured placed blocks. */
const CAT_STATIC = 0x0001;
/** Player / AI squares. */
const CAT_ACTOR = 0x0002;
/** Projectiles (game-layer damage vs actors). */
const CAT_BULLET = 0x0008;
/** Placed block while green / curing: bullets only, actors pass through. */
const CAT_SOFT_BLOCK = 0x0010;

const MASK_STATIC = CAT_STATIC | CAT_ACTOR | CAT_BULLET;
/** Actors collide with hard static only — not soft curing blocks. */
const MASK_ACTOR = CAT_STATIC | CAT_ACTOR;
const MASK_BULLET = CAT_STATIC | CAT_SOFT_BLOCK;
const MASK_SOFT_BLOCK = CAT_BULLET;

function toSimulationBody(
  body: Matter.Body,
  label: SimulationBody["label"]
): SimulationBody {
  const verts = body.vertices.map((v: { x: number; y: number }) => ({
    x: v.x,
    y: v.y,
  }));
  const owner =
    label === "bullet"
      ? (body as Matter.Body & { bulletOwner?: "player" | "ai" }).bulletOwner
      : undefined;
  const damageMul =
    label === "bullet"
      ? (body as Matter.Body & { damageMul?: number }).damageMul ?? 1
      : undefined;
  return {
    id: String(body.id),
    label,
    x: body.position.x,
    y: body.position.y,
    angle: body.angle,
    vx: body.velocity.x,
    vy: body.velocity.y,
    vertices: verts,
    ...(owner ? { bulletOwner: owner } : {}),
    ...(damageMul !== undefined ? { damageMul } : {}),
  };
}

export function createSimulation(config: SimulationConfig): SimulationApi {
  const engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  const world = engine.world;

  const hw = config.halfWidth;
  const hh = config.halfHeight;
  const thick = 80;
  const wallOpts: Matter.IChamferableBodyDefinition = {
    isStatic: true,
    friction: 0.12,
    restitution: 0.45,
    label: "floor",
    collisionFilter: { category: CAT_STATIC, mask: MASK_STATIC },
  };

  const floor = Matter.Bodies.rectangle(0, hh + thick / 2, hw * 2 + thick * 2, thick, {
    ...wallOpts,
  });
  const ceiling = Matter.Bodies.rectangle(0, -hh - thick / 2, hw * 2 + thick * 2, thick, {
    ...wallOpts,
  });
  const left = Matter.Bodies.rectangle(-hw - thick / 2, 0, thick, hh * 2 + thick * 2, {
    ...wallOpts,
  });
  const right = Matter.Bodies.rectangle(hw + thick / 2, 0, thick, hh * 2 + thick * 2, {
    ...wallOpts,
  });

  const side = config.squareSize;
  const actorOpts: Matter.IChamferableBodyDefinition = {
    frictionAir: config.frictionAir ?? 0.018,
    friction: 0.06,
    restitution: 0.62,
    density: 0.0035,
    collisionFilter: { category: CAT_ACTOR, mask: MASK_ACTOR },
  };

  const player = Matter.Bodies.rectangle(
    config.player.x,
    config.player.y,
    side,
    side,
    { ...actorOpts, label: "player" }
  );
  Matter.Body.setAngle(player, config.player.angle);

  const aiBody = Matter.Bodies.rectangle(
    config.ai.x,
    config.ai.y,
    side,
    side,
    { ...actorOpts, label: "ai" }
  );
  Matter.Body.setAngle(aiBody, config.ai.angle);

  const blockOptsHard: Matter.IChamferableBodyDefinition = {
    isStatic: true,
    friction: 0.18,
    restitution: 0.38,
    label: "shield",
    collisionFilter: { category: CAT_STATIC, mask: MASK_STATIC },
  };

  const blockOptsSoft: Matter.IChamferableBodyDefinition = {
    isStatic: true,
    friction: 0.18,
    restitution: 0.38,
    label: "shield",
    collisionFilter: { category: CAT_SOFT_BLOCK, mask: MASK_SOFT_BLOCK },
  };

  const blockBodies: Matter.Body[] = [];
  const bulletBodies: Matter.Body[] = [];
  const specs = config.shields ?? [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    blockBodies.push(
      Matter.Bodies.rectangle(s.x, s.y, s.width, s.height, {
        ...blockOptsHard,
        angle: s.angle ?? 0,
      })
    );
  }

  Matter.World.add(world, [floor, ceiling, left, right, player, aiBody, ...blockBodies]);

  const idToBody = new Map<string, Matter.Body>();
  idToBody.set("player", player);
  idToBody.set("ai", aiBody);

  let destroyed = false;

  return {
    step(deltaMs: number) {
      if (destroyed) return;
      const dt = Math.min(deltaMs / 1000, 1 / 30);
      Matter.Engine.update(engine, dt * 1000);
    },
    getBodies() {
      if (destroyed) return [];
      const out: SimulationBody[] = [];
      out.push(toSimulationBody(floor, "floor"));
      out.push(toSimulationBody(ceiling, "floor"));
      out.push(toSimulationBody(left, "floor"));
      out.push(toSimulationBody(right, "floor"));
      out.push(toSimulationBody(player, "player"));
      out.push(toSimulationBody(aiBody, "ai"));
      for (const bb of blockBodies) {
        out.push(toSimulationBody(bb, "shield"));
      }
      for (const bb of bulletBodies) {
        out.push(toSimulationBody(bb, "bullet"));
      }
      return out;
    },
    applyForce(bodyId: string, fx: number, fy: number) {
      if (destroyed) return;
      const b = idToBody.get(bodyId);
      if (!b) return;
      Matter.Body.applyForce(b, b.position, { x: fx, y: fy });
    },
    setAngularVelocity(bodyId: string, w: number) {
      if (destroyed) return;
      const b = idToBody.get(bodyId);
      if (!b) return;
      Matter.Body.setAngularVelocity(b, w);
    },
    setAngle(bodyId: string, angle: number) {
      if (destroyed) return;
      const b = idToBody.get(bodyId);
      if (!b) return;
      Matter.Body.setAngle(b, angle);
      Matter.Body.setAngularVelocity(b, 0);
    },
    placeCube(x: number, y: number, side: number) {
      if (destroyed) return "";
      const half = side / 2;
      const clampedX = Math.max(-hw + half + 2, Math.min(hw - half - 2, x));
      const clampedY = Math.max(-hh + half + 2, Math.min(hh - half - 2, y));
      const cube = Matter.Bodies.rectangle(clampedX, clampedY, side, side, {
        ...blockOptsSoft,
        angle: 0,
      });
      blockBodies.push(cube);
      Matter.World.add(world, cube);
      return String(cube.id);
    },
    spawnBullet(
      x: number,
      y: number,
      vx: number,
      vy: number,
      radius: number,
      owner: "player" | "ai"
    ) {
      if (destroyed) return "";
      const bullet = Matter.Bodies.circle(x, y, radius, {
        frictionAir: 0,
        friction: 0,
        restitution: 0.96,
        density: 0.00035,
        label: "bullet",
        collisionFilter: { category: CAT_BULLET, mask: MASK_BULLET },
      });
      (bullet as Matter.Body & { bulletOwner?: "player" | "ai" }).bulletOwner =
        owner;
      (bullet as Matter.Body & { damageMul?: number }).damageMul = 1;
      Matter.Body.setVelocity(bullet, { x: vx, y: vy });
      Matter.Body.setAngularVelocity(bullet, 0);
      Matter.Body.setInertia(bullet, Infinity);
      bulletBodies.push(bullet);
      Matter.World.add(world, bullet);
      return String(bullet.id);
    },
    hardenPlacedCube(bodyId: string) {
      if (destroyed) return;
      const b = blockBodies.find((bb) => String(bb.id) === bodyId);
      if (!b) return;
      b.collisionFilter = {
        category: CAT_STATIC,
        mask: MASK_STATIC,
      };
    },
    setBulletVelocity(id: string, vx: number, vy: number) {
      if (destroyed) return;
      const b = bulletBodies.find((bb) => String(bb.id) === id);
      if (!b) return;
      Matter.Body.setVelocity(b, { x: vx, y: vy });
    },
    setBulletPosition(id: string, x: number, y: number) {
      if (destroyed) return;
      const b = bulletBodies.find((bb) => String(bb.id) === id);
      if (!b) return;
      Matter.Body.setPosition(b, { x, y });
    },
    setBulletDamageMul(id: string, mul: number) {
      if (destroyed) return;
      const b = bulletBodies.find((bb) => String(bb.id) === id);
      if (!b) return;
      (b as Matter.Body & { damageMul?: number }).damageMul = mul;
    },
    removeBullet(id: string) {
      if (destroyed) return;
      const idx = bulletBodies.findIndex((b) => String(b.id) === id);
      if (idx === -1) return;
      const b = bulletBodies[idx]!;
      Matter.World.remove(world, b);
      bulletBodies.splice(idx, 1);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      bulletBodies.length = 0;
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
    },
  };
}
