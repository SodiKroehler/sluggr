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
  destroy: () => void;
};

/** Walls/shields; bullets bounce, actors collide. */
const CAT_STATIC = 0x0001;
/** Player / AI squares. */
const CAT_ACTOR = 0x0002;
/** Projectiles: collide with static only (damage vs actors handled in game). */
const CAT_BULLET = 0x0008;
const MASK_STATIC = CAT_STATIC | CAT_ACTOR | CAT_BULLET;
const MASK_ACTOR = CAT_STATIC | CAT_ACTOR;
const MASK_BULLET = CAT_STATIC;

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

  const blockOpts: Matter.IChamferableBodyDefinition = {
    isStatic: true,
    friction: 0.18,
    restitution: 0.38,
    label: "shield",
    collisionFilter: { category: CAT_STATIC, mask: MASK_STATIC },
  };

  const blockBodies: Matter.Body[] = [];
  const bulletBodies: Matter.Body[] = [];
  const specs = config.shields ?? [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    blockBodies.push(
      Matter.Bodies.rectangle(s.x, s.y, s.width, s.height, {
        ...blockOpts,
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
        ...blockOpts,
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
      Matter.Body.setVelocity(bullet, { x: vx, y: vy });
      bulletBodies.push(bullet);
      Matter.World.add(world, bullet);
      return String(bullet.id);
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
