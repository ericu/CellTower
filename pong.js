"use strict";

let bm;
(function () {
  let nsCreep, nsWall, nsTower, nsWeapon, nsScoreboard;
  let nsScenery; // scoreboard, wall
  let nsNonScenery; // creep, tower, weapon
  let nsGlobal;
  let isWall, isBackground, isCreep, isTower, isWeapon;
  let isScoreboard;
  let copySets = {};
  const SCOREBOARD_HEIGHT = 12;  // 10x15 looks good
  const SCOREBOARD_WIDTH = 18;

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

    nsGlobal.declare('FULL_ALPHA', 2, 29);
    if (obviousColors) {
      nsGlobal.declare('FULL_ALPHA', 3, 28);
      nsGlobal.alias('BASIC_BACKGROUND', 'FULL_ALPHA');
    } else {
      nsGlobal.alloc('BASIC_BACKGROUND', 0, 0);
    }

    nsGlobal.declare('IS_SCENERY', 1, 24);
    nsGlobal.setSubspaceMask('IS_SCENERY');
    nsScenery = nsGlobal.declareSubspace('SCENERY', 'IS_SCENERY');
    nsNonScenery = nsGlobal.declareSubspace('NONSCENERY', 0);

    nsNonScenery.declare('ID_0', 1, 15);
    nsNonScenery.declare('ID_1', 1, 7);

    // Sentinel bits that determine type [if all zero, unused so far]:
    nsNonScenery.alias('CREEP_FLAG', 'ID_0');
    nsNonScenery.alias('WEAPON_FLAG', 'ID_1');
    nsNonScenery.combine('ID_BITS', ['ID_0', 'ID_1']);
    nsNonScenery.alias('TOWER_FLAG', 'ID_BITS');
    nsNonScenery.setSubspaceMask('ID_BITS');
    nsCreep = nsNonScenery.declareSubspace('CREEP', 'CREEP_FLAG');
    nsWeapon = nsNonScenery.declareSubspace('WEAPON', 'WEAPON_FLAG');
    nsTower = nsNonScenery.declareSubspace('TOWER', 'TOWER_FLAG');

    nsScenery.declare('IS_WALL', 1, 15);
    nsWall = nsScenery.declareSubspace('WALL', 'IS_WALL');
    nsScoreboard = nsScenery.declareSubspace('SCOREBOARD', 0);

    // Message fields shared by wall and background
    nsWall.alloc('MESSAGE_R_NOT_L', 1);
    if (obviousColors) {
      nsWall.declare('MESSAGE_PRESENT', 1, 14);
    } else {
      nsWall.alloc('MESSAGE_PRESENT', 1);
    }

    nsWall.alloc('LISTEN_DOWN', 1);
    nsWall.alloc('LISTEN_UP_FOR_L', 1);
    nsWall.alloc('LISTEN_UP_FOR_R', 1);
    if (obviousColors) {
      nsWall.alloc('LISTEN_RIGHT_FOR_R', 1);
      nsWall.alloc('LISTEN_LEFT_FOR_L', 1);
      nsWall.alloc('LISTEN_LEFT', 1);
      nsWall.alloc('LISTEN_RIGHT', 1);
    } else {
      nsWall.declare('LISTEN_RIGHT_FOR_R', 1, 17);
      nsWall.declare('LISTEN_LEFT_FOR_L', 1, 18);
      nsWall.declare('LISTEN_LEFT', 1, 19);
      nsWall.declare('LISTEN_RIGHT', 1, 20);
    }
    nsWall.alloc('TALK_DOWN_FOR_L', 1);
    nsWall.alloc('TALK_DOWN_FOR_R', 1);
    nsWall.alloc('SIDE_WALL_FLAG', 1);
    if (obviousColors) {
      nsWall.alloc('LISTEN_SIDE_FOR_GAME_OVER', 1);
    } else {
      nsWall.declare('LISTEN_SIDE_FOR_GAME_OVER', 1, 16);
    }

    isWall = getHasValueFunction(bm.or([nsGlobal.IS_SCENERY.getMask(),
                                       nsScenery.IS_SCENERY.getMask()]),
                                 bm.or([nsScenery.IS_WALL.getMask(),
                                       nsScenery.IS_WALL.getMask()]));
    // TODO
    /*
    initScoreboard(nsScoreboard, nsGlobal.IS_NOT_BACKGROUND.getMask(),
                   nsNonbackground.FULL_ALPHA, isScoreboard,
                   isSendingMessageDown, isSignallingGameOver, obviousColors);
    */
    nsGlobal.dumpStatus();
  }

  function isSendingMessageDown(c) {
    return isSendingLeftMessageDown(c) || isSendingRightMessageDown(c);
  }

  function isSignallingGameOver(c) {
    return isWall(c) && nsWall.LISTEN_SIDE_FOR_GAME_OVER.isSet(c) &&
      nsWall.MESSAGE_PRESENT.isSet(c);
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

  function initPong(c, originX, originY, width, height, obviousColors) {
    initBitManager(obviousColors);

    let leftScoreboardRightEdge = originX + SCOREBOARD_WIDTH - 1;
    let rightScoreboardLeftEdge = originX + width - SCOREBOARD_WIDTH;
    let leftRespawnDownPathX = leftScoreboardRightEdge - 2;
    let rightRespawnDownPathX = rightScoreboardLeftEdge + 2;

    // background
    let background = nsBackground.BASIC_BACKGROUND.getMask();
    c.fillRect(background, 0, 0, canvas.width, canvas.height);

    // walls
    let color = bm.or([nsGlobal.IS_NOT_BACKGROUND.getMask(),
                       nsNonbackground.WALL_FLAG.getMask(),
                       nsNonbackground.FULL_ALPHA.getMask()]);
    c.strokeRect(color, originX, originY,
                 SCOREBOARD_WIDTH, SCOREBOARD_HEIGHT + 1);
    c.strokeRect(color, originX + width - SCOREBOARD_WIDTH, originY,
                 SCOREBOARD_WIDTH, SCOREBOARD_HEIGHT + 1);
    c.strokeRect(color, originX, originY,
                 width, SCOREBOARD_HEIGHT + 1);
    c.strokeRect(color, gameOriginX, gameOriginY,
                 gameWidth, gameHeight);
    c.orRect(nsWall.SIDE_WALL_FLAG.getMask(),
             gameOriginX, gameOriginY + 1, 1, gameHeight - 2);
    c.orRect(nsWall.LISTEN_DOWN.getMask(),
             originX, originY, 1, height - 1);
    c.orRect(nsWall.SIDE_WALL_FLAG.getMask(),
             gameOriginX + gameWidth - 1, gameOriginY + 1, 1, gameHeight - 2);
    c.orRect(nsWall.LISTEN_DOWN.getMask(),
             originX + width - 1, originY, 1, height - 1);

    c.orRect(nsWall.LISTEN_LEFT.getMask(),
             originX + 1, originY, rightScoreboardLeftEdge - originX + 1, 1);
    c.orRect(nsWall.LISTEN_RIGHT.getMask(),
             leftScoreboardRightEdge - 1, originY,
             width - SCOREBOARD_WIDTH + 1, 1);

    drawScoreboard(c, originX + 1, originY + 1,
                   SCOREBOARD_WIDTH - 2, SCOREBOARD_HEIGHT - 1);
    drawScoreboard(c, rightScoreboardLeftEdge + 1, originY + 1,
                   SCOREBOARD_WIDTH - 2, SCOREBOARD_HEIGHT - 1);
    drawGameOver(c, leftScoreboardRightEdge + 1, originY + 1,
                 rightScoreboardLeftEdge - leftScoreboardRightEdge - 1,
                 SCOREBOARD_HEIGHT - 1);
  }

  function pong(data, x, y) {
    const current = data[4];
    let v;

    if (isScoreboard(current)) {
      return handleScoreboard(data, x, y);
    }

    if (isWall(current)) {
      return handleWall(data, x, y);
    }

    // TODO
  }

  let width = DESIRED_BALL_AREA_WIDTH + 4; // 2x trough, 2x wall
  let height = DESIRED_BALL_AREA_HEIGHT + 2 + SCOREBOARD_HEIGHT; // 2x wall
  registerAnimation("pong", width, height, initPong, pong);

})();
