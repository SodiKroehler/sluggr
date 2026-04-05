import Matter from "matter-js";

type SimulationBody = {
  id: string;
  label: "player" | "ai" | "floor" | "shield";
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  vertices: { x: number; y: number }[];
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
  /** Edge length of the player / AI square. */
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
  destroy: () => void;
};

function toSimulationBody(
  body: Matter.Body,
  label: SimulationBody["label"]
): SimulationBody {
  const verts = body.vertices.map((v: { x: number; y: number }) => ({
    x: v.x,
    y: v.y,
  }));
  return {
    id: String(body.id),
    label,
    x: body.position.x,
    y: body.position.y,
    angle: body.angle,
    vx: body.velocity.x,
    vy: body.velocity.y,
    vertices: verts,
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

  const shieldOpts: Matter.IChamferableBodyDefinition = {
    frictionAir: config.frictionAir ?? 0.025,
    friction: 0.18,
    restitution: 0.38,
    density: 0.01,
    label: "shield",
  };

  const shieldBodies: Matter.Body[] = [];
  const specs = config.shields ?? [];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    const rect = Matter.Bodies.rectangle(s.x, s.y, s.width, s.height, {
      ...shieldOpts,
      angle: s.angle ?? 0,
    });
    shieldBodies.push(rect);
  }

  Matter.World.add(world, [floor, ceiling, left, right, player, aiBody, ...shieldBodies]);

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
      for (const sb of shieldBodies) {
        out.push(toSimulationBody(sb, "shield"));
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
    destroy() {
      if (destroyed) return;
      destroyed = true;
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
    },
  };
}
