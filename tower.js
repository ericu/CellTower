"use strict";

let bm;
(function () {
  let nsCreep, nsWall, nsTower, nsWeapon, nsScoreboard;
  let nsScenery; // scoreboard, wall
  let nsNonScenery; // creep, tower, weapon
  let nsGlobal;
  let isWall, isBackground, isCreep, isTower, isWeapon;
  let MAX_CREEP_GENERATION;
  let isScoreboard;
  let copySets = {};
  const SCOREBOARD_HEIGHT = 0;
  const SCOREBOARD_WIDTH = 0;
  const PHASE_BITS = 2;
  const PHASE_COUNT = 1 << PHASE_BITS;
  const CREEP_PHASE = 0;
  const TOWER_PHASE = 1;
  const WEAPON_PHASE = 2;
  const WALL_PHASE = 3; // needed?

  function initBitManager(obviousColors) {
    nsGlobal = new Namespace();
    // TODO: Pass in canvas.
    canvas.ns = nsGlobal;
    bm = new BitManager(nsGlobal);
    // Bits are 0xAABBGGRR because of endianness; TODO: Make endian-independent.

    // TODO: We don't have much going on in the background now; we probably
    // don't need 30 bits of it.  In fact, if it can get its phase counter from
    // whatever's moving through it, it probably doesn't need anything at all,
    // it's just not anything else.

    if (obviousColors) {
      nsGlobal.declare('FULL_ALPHA', 3, 29);
      nsGlobal.alias('BASIC_BACKGROUND', 'FULL_ALPHA');
    } else {
      nsGlobal.declare('FULL_ALPHA', 2, 30);
      nsGlobal.alloc('BASIC_BACKGROUND', 0);
    }
    nsGlobal.alloc('PHASE', PHASE_BITS); // not needed by background, though

    nsGlobal.declare('IS_SCENERY', 1, 24);
    nsGlobal.setSubspaceMask('IS_SCENERY');
    nsScenery = nsGlobal.declareSubspace('SCENERY', 'IS_SCENERY');
    nsNonScenery = nsGlobal.declareSubspace('NONSCENERY', 0);

    nsNonScenery.declare('ID_0', 1, 7);
    nsNonScenery.declare('ID_1', 1, 15);

    nsNonScenery.alias('CREEP_FLAG', 'ID_0');
    nsNonScenery.alias('WEAPON_FLAG', 'ID_1');
    nsNonScenery.combine('ID_BITS', ['ID_0', 'ID_1']);
    nsNonScenery.alias('TOWER_FLAG', 'ID_BITS');
    nsNonScenery.setSubspaceMask('ID_BITS');
    nsCreep = nsNonScenery.declareSubspace('CREEP', 'CREEP_FLAG');
    nsWeapon = nsNonScenery.declareSubspace('WEAPON', 'WEAPON_FLAG');
    nsTower = nsNonScenery.declareSubspace('TOWER', 'TOWER_FLAG');
    const nsUnused = nsNonScenery.declareSubspace('UNUSED', 0);

    // TODO: Standardize on IS_FOO or FOO_FLAG?
    isCreep = getHasValueFunction(bm.or([nsGlobal.IS_SCENERY.getMask(),
                                         nsNonScenery.CREEP_FLAG.getMask()]),
                                  nsNonScenery.CREEP_FLAG.getMask());
    nsScenery.declare('IS_WALL', 1, 15);
    nsScenery.setSubspaceMask('IS_WALL');
    nsWall = nsScenery.declareSubspace('WALL', 'IS_WALL');
    nsScoreboard = nsScenery.declareSubspace('SCOREBOARD', 0);

    isWall = getHasValueFunction(bm.or([nsGlobal.IS_SCENERY.getMask(),
                                       nsScenery.IS_WALL.getMask()]),
                                 bm.or([nsGlobal.IS_SCENERY.getMask(),
                                       nsScenery.IS_WALL.getMask()]));

    let CREEP_GENERATION_BITS = 2;
    nsCreep.alloc('GENERATION', CREEP_GENERATION_BITS)
    MAX_CREEP_GENERATION = (1 << CREEP_GENERATION_BITS) - 1;

    // TODO
    /*
    initScoreboard(nsScoreboard, nsGlobal.IS_NOT_BACKGROUND.getMask(),
                   nsNonbackground.FULL_ALPHA, isScoreboard,
                   isSendingMessageDown, isSignallingGameOver, obviousColors);
    */
    nsGlobal.dumpStatus();
  }

  function sourceDirectionFromIndex(i) {
    let dirBits;
    switch (i) {
      case 0:
        return { dX:  1, dY:  1 };
      case 1:
        return { dX:  0, dY:  1 };
      case 2:
        return { dX: -1, dY:  1 };
      case 3:
        return { dX:  1, dY:  0 };
      case 4:
        return { dX:  0, dY:  0 };
      case 5:
        return { dX: -1, dY:  0 };
      case 6:
        return { dX:  1, dY: -1 };
      case 7:
        return { dX:  0, dY: -1 };
      case 8:
        return { dX: -1, dY: -1 };
      default: assert(false);
    }
  }

  function isActivePhase(phase, packed) {
    return phase === nsGlobal.PHASE.get(packed);
  }
  function getNextPhase(phase) {
    return (phase + 1) % PHASE_COUNT;
  }
  function incrementPhase(packed) {
    let phase = getNextPhase(nsGlobal.PHASE.get(packed));
    return nsGlobal.PHASE.set(packed, phase);
  }

  // Creeps are created during CREEP_PHASE, so they start holding the phase
  // after that.
  function newCreepColor() {
    let packed = bm.or([nsGlobal.FULL_ALPHA.getMask(),
                        nsNonScenery.CREEP_FLAG.getMask(),
                        nsCreep.GENERATION.getMask()])
    let phase = getNextPhase(CREEP_PHASE);
    return nsGlobal.PHASE.set(packed, phase);
  }

  function initTower(c, originX, originY, width, height, obviousColors) {
    const gameOriginX = originX;
    const gameOriginY = originY + SCOREBOARD_HEIGHT;
    const gameWidth = width;
    const gameHeight = height - SCOREBOARD_HEIGHT;

    initBitManager(obviousColors);

    // background
    let background = nsGlobal.BASIC_BACKGROUND.getMask();
    c.fillRect(background, 0, 0, canvas.width, canvas.height);

    // walls
    let color = bm.or([nsGlobal.IS_SCENERY.getMask(),
                       nsScenery.IS_WALL.getMask(),
                       nsGlobal.FULL_ALPHA.getMask()]);
    c.strokeRect(color, originX, originY,
                 gameWidth, gameHeight + SCOREBOARD_HEIGHT);

    let passages = 5
    let spacing = Math.floor(gameHeight / (passages + 0.5) / 2);
    let wallWidth = Math.floor(gameWidth * 0.9);
    for (let i = 0; i < passages; ++i) {
      c.strokeRect(color, originX, originY + (2 * i + 1) * spacing,
                   wallWidth, 1);
      c.strokeRect(color, gameWidth - wallWidth,
                   originY + (2 * (i + 1)) * spacing, wallWidth, 1);
    }

    c.fillRect(background,
               Math.round(canvas.width / 4), Math.round(4.5 * spacing),
               spacing, spacing);

    c.fillRect(newCreepColor(), 3, Math.round(spacing / 2), 1, 1)
/* TODO: initScoreboard first.
    drawScoreboard(c, originX + 1, originY + 1,
                   SCOREBOARD_WIDTH - 2, SCOREBOARD_HEIGHT - 1);
    drawScoreboard(c, rightScoreboardLeftEdge + 1, originY + 1,
                   SCOREBOARD_WIDTH - 2, SCOREBOARD_HEIGHT - 1);
    drawGameOver(c, leftScoreboardRightEdge + 1, originY + 1,
                 rightScoreboardLeftEdge - leftScoreboardRightEdge - 1,
                 SCOREBOARD_HEIGHT - 1);
                 */
  }

  function handleWall(data, x, y) {
    return data[4];
  }

  function getCreepGeneration(packed) {
    return nsCreep.GENERATION.get(packed);
  }
  function setCreepGeneration(packed, value) {
    return nsCreep.GENERATION.set(packed, value);
  }

  function handleCreep(data, x, y) {
    const current = data[4];
    let next;
    if (isActivePhase(CREEP_PHASE, current)) {
      let counter = getCreepGeneration(current);
      if (--counter <= 0) {
        next = nsGlobal.BASIC_BACKGROUND.getMask();
      } else {
        next = setCreepGeneration(current, counter);
      }
    } else {
      next = current
    }
    return incrementPhase(next);
  }

  function handleBackground(data, x, y) {
    for (let index in data) {
      if (index % 2) {
        let value = data[index];
        if (isCreep(value) && isActivePhase(CREEP_PHASE, value) &&
            getCreepGeneration(value) == MAX_CREEP_GENERATION) {
          return newCreepColor();
        }
      }
    }
    return data[4];
  }

  function tower(data, x, y) {
    const current = data[4];
    let v;

//    if (isScoreboard(current)) {
//      return handleScoreboard(data, x, y);
//    }

    if (isWall(current)) {
      return handleWall(data, x, y);
    }

    if (isCreep(current)) {
      return handleCreep(data, x, y);
    }

    return handleBackground(data, x, y);
  }

  let width = 100;
  let height = 100 + SCOREBOARD_HEIGHT; // 2x wall
  registerAnimation("tower", width, height, initTower, tower);

})();
