"use strict";

let bm;
(function () {
  let nsCreep, nsWall, nsTower, nsWeapon, nsScoreboard;
  let nsScenery; // scoreboard, wall
  let nsNonScenery; // creep, tower, weapon
  let nsGlobal;
  let isWall, isBackground, isCreep, isTower, isWeapon;
  let MAX_CREEP_GENERATION;
  let MAX_CREEP_HP;
  let MAX_WEAPON_GENERATION;
  let MAX_WEAPON_DAMAGE;
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

    nsGlobal.declare('SCENERY_FLAG', 1, 24);
    nsGlobal.setSubspaceMask('SCENERY_FLAG');
    nsScenery = nsGlobal.declareSubspace('SCENERY', 'SCENERY_FLAG');
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

    // TODO: BitManager should be able to generate this function given just the
    // lowest-level bits, since it knows the namespace tree.
    isCreep = getHasValueFunction(bm.or([nsGlobal.SCENERY_FLAG.getMask(),
                                         nsNonScenery.CREEP_FLAG.getMask()]),
                                  nsNonScenery.CREEP_FLAG.getMask());
    isWeapon = getHasValueFunction(bm.or([nsGlobal.SCENERY_FLAG.getMask(),
                                         nsNonScenery.WEAPON_FLAG.getMask()]),
                                  nsNonScenery.WEAPON_FLAG.getMask());
    nsScenery.declare('WALL_FLAG', 1, 15);
    nsScenery.setSubspaceMask('WALL_FLAG');
    nsWall = nsScenery.declareSubspace('WALL', 'WALL_FLAG');
    nsScoreboard = nsScenery.declareSubspace('SCOREBOARD', 0);

    isWall = getHasValueFunction(bm.or([nsGlobal.SCENERY_FLAG.getMask(),
                                       nsScenery.WALL_FLAG.getMask()]),
                                 bm.or([nsGlobal.SCENERY_FLAG.getMask(),
                                       nsScenery.WALL_FLAG.getMask()]));

    let CREEP_GENERATION_BITS = 2;
    nsCreep.alloc('GENERATION', CREEP_GENERATION_BITS)
    MAX_CREEP_GENERATION = (1 << CREEP_GENERATION_BITS) - 1;

    let CREEP_HP_BITS = 3;
    nsCreep.alloc('HP', CREEP_HP_BITS)
    MAX_CREEP_HP = (1 << CREEP_HP_BITS) - 1;

    let WEAPON_GENERATION_BITS = 3;
    nsWeapon.alloc('GENERATION', WEAPON_GENERATION_BITS)
    MAX_WEAPON_GENERATION = (1 << WEAPON_GENERATION_BITS) - 1;
    // Currently we limit weapons to 4 directions; we could add more.
    nsWeapon.alloc('DIRECTION', 2); // up, right, down, left
    let WEAPON_DAMAGE_BITS = 2;
    nsWeapon.alloc('DAMAGE', WEAPON_DAMAGE_BITS);
    MAX_WEAPON_DAMAGE = (1 << WEAPON_DAMAGE_BITS) - 1;


    // TODO
    /*
    initScoreboard(nsScoreboard, nsGlobal.IS_NOT_BACKGROUND.getMask(),
                   nsNonbackground.FULL_ALPHA, isScoreboard,
                   isSendingMessageDown, isSignallingGameOver, obviousColors);
    */
    nsGlobal.dumpStatus();
  }

  // This is the diretion from the source toward you, with positive DX to the
  // right, and positive DY down, matching the canvas.
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

  function weaponDirectionToOffsets(dir) {
    switch (dir) {
      case 0:
        return { dX:  0, dY:  1 };
      case 1:
        return { dX:  1, dY:  0 };
      case 2:
        return { dX:  0, dY: -1 };
      case 3:
        return { dX: -1, dY:  0 };
    }
    assert(false, "Invalid weapon direction.");
  }

  function offsetsToWeaponDirection(dX, dY) {
    assert(!dX || !dY);
    assert(!dX || Math.abs(dX) === 1);
    assert(!dY || Math.abs(dY) === 1);
    if (dY > 0) {
      return 0;
    }
    if (dX > 0) {
      return 1;
    }
    if (dY < 0) {
      return 2;
    }
    if (dX < 0) {
      return 3;
    }
    assert(false, "Offsets can't both be zero.");
  }

  function getWeaponDirectionOffsets(packed) {
    return weaponDirectionToOffsets(nsWeapon.DIRECTION.get(packed));
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
  function newCreepColor(hp) {
    let packed = bm.or([nsGlobal.FULL_ALPHA.getMask(),
                        nsNonScenery.CREEP_FLAG.getMask(),
                        nsCreep.GENERATION.getMask()])
    let phase = getNextPhase(CREEP_PHASE);
    packed = nsGlobal.PHASE.set(packed, phase);
    packed = nsCreep.HP.set(packed, hp);
    return packed;
  }

  function newWeaponColor(dX, dY) {
    let packed = bm.or([nsGlobal.FULL_ALPHA.getMask(),
                        nsNonScenery.WEAPON_FLAG.getMask(),
                        nsWeapon.GENERATION.getMask(),
                        nsWeapon.DAMAGE.getMask()])
    packed = nsGlobal.PHASE.set(packed, getNextPhase(WEAPON_PHASE));
    packed = nsWeapon.DIRECTION.set(packed, offsetsToWeaponDirection(dX, dY));
    return packed;
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
    let color = bm.or([nsGlobal.SCENERY_FLAG.getMask(),
                       nsScenery.WALL_FLAG.getMask(),
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

    let creepColor = nsGlobal.PHASE.set(newCreepColor(MAX_CREEP_HP), 0);
    c.fillRect(creepColor, 3, Math.round(spacing / 2), 1, 1)

    let weapongColor = nsGlobal.PHASE.set(newWeaponColor(-1, 0), 0);
    c.fillRect(weapongColor, Math.round(gameWidth / 2),
               Math.round(spacing / 2), 1, 1)
    c.fillRect(weapongColor, Math.round(gameWidth - 1),
               Math.round(spacing / 2), 1, 1)
    c.fillRect(weapongColor, Math.round(3 * gameWidth / 4),
               Math.round(spacing / 2), 1, 1)
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
  function getCreepHp(packed) {
    return nsCreep.HP.get(packed);
  }
  function setCreepHp(packed, hp) {
    return nsCreep.HP.set(packed, hp);
  }
  function setCreepGeneration(packed, value) {
    return nsCreep.GENERATION.set(packed, value);
  }

  function getWeaponGeneration(packed) {
    return nsWeapon.GENERATION.get(packed);
  }
  function setWeaponGeneration(packed, value) {
    return nsWeapon.GENERATION.set(packed, value);
  }
  function getWeaponDamage(packed) {
    return nsWeapon.DAMAGE.get(packed);
  }

  function handleCreep(data, x, y) {
    const current = data[4];
    // We only die on the active phase, to ensure propagation of the damage.
    if (isActivePhase(CREEP_PHASE, current)) {
      if (getCreepHp(current) === 0) {
        return nsGlobal.BASIC_BACKGROUND.getMask();
      }
    }
    // Propagate damage, even out of phase.
    let hp = getCreepHp(current);
    for (let index = 0; index < 9; ++index) {
      let value = data[index];
      if (isCreep(value)) {
        // This is questionable long-term; should all creeps share damage/hp on
        // contact?
        hp = Math.min(hp, getCreepHp(value));
      }
    }
    let next = setCreepHp(current, hp);
    if (isActivePhase(CREEP_PHASE, next)) {
      let counter = getCreepGeneration(next);
      if (--counter <= 0) {
        // We don't give the background a phase currently.
        return nsGlobal.BASIC_BACKGROUND.getMask();
      } else {
        next = setCreepGeneration(next, counter);
      }
      for (let index = 0; index < 9; ++index) {
        let value = data[index];
        if (isWeapon(value)) {
          let weaponGen = getWeaponGeneration(value)
          // Must allow for top 2 generations due to not knowing who
          // approached whom first.
          if (weaponGen === MAX_WEAPON_GENERATION ||
              weaponGen === MAX_WEAPON_GENERATION - 1) {
            hp = Math.max(0, hp - getWeaponDamage(value));
            // Have to stick around long enough to tell the rest of me, even if
            // I'm at zero hp.
            next = setCreepHp(next, hp);
          }
        }
      }
    }
    return incrementPhase(next);
  }

  function handleWeapon(data, x, y) {
    const current = data[4];
    // Let creeps overwrite weapons.
    for (let index = 0; index < 9; ++index) {
      if (index % 2) {
        let value = data[index];
        if (isCreep(value) && isActivePhase(CREEP_PHASE, value) &&
            getCreepGeneration(value) == MAX_CREEP_GENERATION) {
          return newCreepColor(getCreepHp(value));
        }
      }
    }
    let next;
    if (isActivePhase(WEAPON_PHASE, current)) {
      let counter = getWeaponGeneration(current);
      if (--counter <= 0) {
        next = nsGlobal.BASIC_BACKGROUND.getMask();
      } else {
        next = setWeaponGeneration(current, counter);
      }
    } else {
      next = current
    }
    return incrementPhase(next);
  }

  function handleBackground(data, x, y) {
    for (let index = 0; index < 9; ++index) {
      let value = data[index];
      if (index % 2) { // tweak creep propagation
        if (isCreep(value) && isActivePhase(CREEP_PHASE, value) &&
            getCreepGeneration(value) == MAX_CREEP_GENERATION &&
            getCreepHp(value)) {
          return newCreepColor(getCreepHp(value));
        }
      }
      let dir = sourceDirectionFromIndex(index);
      if (isWeapon(value) && isActivePhase(WEAPON_PHASE, value) &&
          getWeaponGeneration(value) == MAX_WEAPON_GENERATION) {
        let weaponDir = getWeaponDirectionOffsets(value);
        if ((dir.dX == weaponDir.dX) && (dir.dY == weaponDir.dY)) {
          console.log('dir', dir, 'weaponDir', weaponDir, 'index', index)
          return newWeaponColor(dir.dX, dir.dY);
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

    if (isWeapon(current)) {
      return handleWeapon(data, x, y);
    }

    return handleBackground(data, x, y);
  }

  let width = 100;
  let height = 100 + SCOREBOARD_HEIGHT; // 2x wall
  registerAnimation("tower", width, height, initTower, tower);

})();
