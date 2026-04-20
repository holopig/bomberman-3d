/* ====================================================
   Bomberman 3D  —  FULL GAMEPLAY VERSION
   (Three.js, Vanilla JS, Vite)
   ==================================================== */

import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─── Constants ────────────────────────────────────────
const GRID_SIZE = 11;
const CELL_SIZE = 1;
const HALF_GRID = (GRID_SIZE - 1) / 2;
const BOMB_TIMER = 3000; // ms
const EXPLOSION_RADIUS = 2; // cells
const EXPLOSION_DURATION = 800; // ms
const RESPAWN_TIME = 2000; // ms

// ─── DOM Elements ───────────────────────────────────
const canvas = document.getElementById('game-canvas');
const loadingScreen = document.getElementById('loading-screen');
const hud = document.getElementById('hud');
const livesDisplay = document.getElementById('lives-count');
const gameOverOverlay = document.getElementById('game-over');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');
const restartBtn = document.getElementById('restart-btn');

// ─── Three.js Core ──────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a12);
scene.fog = new THREE.FogExp2(0x0a0a12, 0.03);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 10, 12);
camera.lookAt(0, 0, 0);

const clock = new THREE.Clock();

// ─── Loading Manager ────────────────────────────────
const manager = new THREE.LoadingManager();
manager.onStart = (url, itemsLoaded, itemsTotal) => {
  console.log(`[Loading] Started: ${url} (${itemsLoaded}/${itemsTotal})`);
  // Simple timeout check
  setTimeout(() => {
    if (!manager.itemsLoadedSet.has(url)) {
      console.error(`ERROR: Loading timeout for [${url}]`);
    }
  }, 5000);
};
manager.itemsLoadedSet = new Set();
manager.onProgress = (url, itemsLoaded, itemsTotal) => {
  manager.itemsLoadedSet.add(url);
  const progress = Math.round((itemsLoaded / itemsTotal) * 100);
  console.log(`[Loading] ${progress}% : ${url}`);
};
manager.onLoad = () => {
  console.log('[Loading] All assets ready!');
};
manager.onError = (url) => {
  console.error(`[Loading] Error loading: ${url}`);
};

const gltfLoader = new GLTFLoader(manager);
const audioLoader = new THREE.AudioLoader(manager);
const textureLoader = new THREE.TextureLoader(manager);
const listener = new THREE.AudioListener();
camera.add(listener);
const grassTex = textureLoader.load('/textures/grass.jpg');
grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
grassTex.repeat.set(12, 12);

const stoneTex = textureLoader.load('/textures/stone.jpg');
stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;

const trimTex = textureLoader.load('/textures/trim.jpg');
trimTex.wrapS = trimTex.wrapT = THREE.RepeatWrapping;

// ─── Game State ──────────────────────────────────────
const gameState = {
  isPaused: false,
  isGameOver: false,
  entities: [],
  bombs: [],
  explosions: [],
  walls: [], // indestructible
  blocks: [], // destructible (TODO: add later if needed)
  levelLoaded: false,
  audio: {
    unlocked: false,
    bgm: null,
    sfx: {
      place: null,
      explode: [] // Pool of explosion sounds
    }
  }
};

// ─── Base Entity Class ───────────────────────────────
class Entity {
  constructor(name, startPos) {
    this.name = name;
    this.mesh = null;
    this.mixer = null;
    this.actions = {};
    this.currentAction = '';
    this.lives = 3;
    this.isDead = false;
    this.isInvulnerable = false;
    this.startPos = startPos.clone();
    this.position = startPos.clone();
    this.targetRotation = 0;
    this.speed = 4;
  }

  loadModel(path, scale, onComplete) {
    gltfLoader.load(path, (gltf) => {
      this.mesh = gltf.scene;
      this.mesh.scale.setScalar(scale);
      this.mesh.position.copy(this.position);
      this.mesh.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(this.mesh);

      this.mixer = new THREE.AnimationMixer(this.mesh);
      this.setupAnimations(gltf.animations);
      
      if (onComplete) onComplete();
    });
  }

  setupAnimations(animations) {
    // Override in subclasses
  }

  switchAnimation(name) {
    if (this.currentAction === name || !this.actions[name]) return;
    const prev = this.actions[this.currentAction];
    const next = this.actions[name];
    if (prev) prev.fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    this.currentAction = name;
  }

  takeDamage() {
    if (this.isInvulnerable || this.isDead) return;
    
    this.lives--;
    this.updateHUD();
    
    if (this.lives <= 0) {
      this.die();
    } else {
      this.hit();
    }
  }

  hit() {
    this.isInvulnerable = true;
    this.switchAnimation('fall');
    
    // Disable movement during hit
    const originalSpeed = this.speed;
    this.speed = 0;

    setTimeout(() => {
      if (!this.isDead) {
        this.respawn(originalSpeed);
      }
    }, RESPAWN_TIME);
  }

  respawn(originalSpeed) {
    this.position.copy(this.startPos);
    this.speed = originalSpeed;
    this.isInvulnerable = false;
    this.switchAnimation('idle');
    
    // Visual feedback for invulnerability
    const flashInterval = setInterval(() => {
      if (!this.isInvulnerable) {
        this.mesh.visible = true;
        clearInterval(flashInterval);
        return;
      }
      this.mesh.visible = !this.mesh.visible;
    }, 100);
    
    setTimeout(() => {
      this.isInvulnerable = false;
    }, 2000);
  }

  die() {
    this.isDead = true;
    this.switchAnimation('fall');
    this.speed = 0;
    checkGameOver();
  }

  updateHUD() {
    // To be overridden for player
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
  }
}

// ─── Player Class ────────────────────────────────────
class Player extends Entity {
  constructor(startPos) {
    super('Player', startPos);
    this.keys = {};
    window.addEventListener('keydown', (e) => this.keys[e.code] = true);
    window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.isDead && !gameState.isGameOver) {
        placeBomb(this);
      }
    });
  }

  setupAnimations(animations) {
    // Animations for player: ["Fall3", "Idle_11", "Running", "Walking", "run_fast_2"]
    const idleClip = animations.find(a => a.name === 'Idle_11');
    const runClip = animations.find(a => a.name === 'Running') || animations.find(a => a.name === 'Walking');
    const fallClip = animations.find(a => a.name === 'Fall3');

    if (idleClip) this.actions.idle = this.mixer.clipAction(idleClip);
    if (runClip) this.actions.run = this.mixer.clipAction(runClip);
    if (fallClip) {
      this.actions.fall = this.mixer.clipAction(fallClip);
      this.actions.fall.setLoop(THREE.LoopOnce);
      this.actions.fall.clampWhenFinished = true;
    }

    this.switchAnimation('idle');
  }

  updateHUD() {
    livesDisplay.textContent = Math.max(0, this.lives);
  }

  update(dt) {
    super.update(dt);
    if (this.isDead || this.speed === 0 || gameState.isGameOver) return;

    let dx = 0, dz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) dz = -1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dz = 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx = -1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx = 1;

    if (dx !== 0 || dz !== 0) {
      const len = Math.sqrt(dx * dx + dz * dz);
      dx /= len; dz /= len;

      const nextX = this.position.x + dx * this.speed * dt;
      const nextZ = this.position.z + dz * this.speed * dt;

      if (!checkCollision(nextX, this.position.z, this)) this.position.x = nextX;
      if (!checkCollision(this.position.x, nextZ, this)) this.position.z = nextZ;

      this.targetRotation = Math.atan2(dx, dz);
      this.switchAnimation('run');
    } else {
      this.switchAnimation('idle');
    }

    this.mesh.position.copy(this.position);
    
    // Smooth rotation
    let diff = this.targetRotation - this.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.mesh.rotation.y += diff * dt * 10;
  }
}

// ─── Enemy Class (Behavior Tree) ────────────────────
class Enemy extends Entity {
  constructor(startPos) {
    super('Enemy', startPos);
    this.speed = 3.2; // 80% of player speed (4)
    this.aiState = 'HUNT'; 
    this.path = [];
    this.decisionTimer = 0;
    this.decisionLockTimer = 0; // Hysteresis / Retargeting limit
    this.isEvading = false;     // Sticky state flag
    this.bombCooldown = 0;
  }

  setupAnimations(animations) {
    const idleClip = animations.find(a => a.name === 'Idle_11');
    const runClip = animations.find(a => a.name === 'Running') || animations.find(a => a.name === 'Walking');
    const hitClip = animations.find(a => a.name === 'BeHit_FlyUp');

    if (idleClip) this.actions.idle = this.mixer.clipAction(idleClip);
    if (runClip) this.actions.run = this.mixer.clipAction(runClip);
    if (hitClip) {
      this.actions.fall = this.mixer.clipAction(hitClip);
      this.actions.fall.setLoop(THREE.LoopOnce);
      this.actions.fall.clampWhenFinished = true;
    }
    this.switchAnimation('idle');
  }

  update(dt) {
    super.update(dt);
    if (this.isDead || this.speed === 0 || gameState.isGameOver) {
      if (this.lives <= 0) this.switchAnimation('fall');
      return;
    }

    this.decisionTimer -= dt;
    this.decisionLockTimer -= dt;
    this.bombCooldown -= dt;

    const oldX = this.position.x;
    const oldZ = this.position.z;

    if (this.decisionTimer <= 0 || this.path.length === 0) {
      this.makeDecision();
    }

    if (this.path.length > 0) {
      this.followPath(dt);
    }

    // Velocity-based animation controller
    const dx = this.position.x - oldX;
    const dz = this.position.z - oldZ;
    const velocityMag = Math.sqrt(dx * dx + dz * dz) / dt;

    if (velocityMag > 0.1) {
      this.switchAnimation('run');
    } else {
      this.switchAnimation('idle');
    }
  }

  makeDecision() {
    const rx = Math.round(this.position.x);
    const rz = Math.round(this.position.z);
    const inDanger = this.isCellInDanger(rx, rz);

    // 1. FLEE (Absolute Priority & Sticky State)
    if (inDanger) {
      this.isEvading = true;
      this.aiState = 'FLEE';
      const safeCell = this.findSafeCell();
      if (safeCell) {
        const p = this.findPath({x: rx, z: rz}, safeCell);
        if (p) {
          this.path = p;
          this.decisionTimer = 0.5; // Reset timer
          return;
        }
      }
    }

    // If we are evading but reached a safe cell, drop the flag
    if (this.isEvading && !inDanger) {
      this.isEvading = false;
    }

    // Sticky State: If still evading, do not retarget or attack
    if (this.isEvading) return;

    // Rate limit standard decisions (retargeting)
    if (this.decisionLockTimer > 0 && this.path.length > 0) return;
    this.decisionLockTimer = 0.5; // 500ms max retarget rate
    this.decisionTimer = 0.5;

    // 2. ATTACK (If near player and safe)
    const playerX = Math.round(player.position.x);
    const playerZ = Math.round(player.position.z);
    const distToPlayer = Math.abs(rx - playerX) + Math.abs(rz - playerZ);
    
    if (distToPlayer <= 1 && this.bombCooldown <= 0) {
      if (this.canEscapeAfterBomb(rx, rz)) {
        placeBomb(this);
        this.bombCooldown = 4;
        this.aiState = 'FLEE';
        this.isEvading = true;
        const safe = this.findSafeCell();
        if (safe) {
          const p = this.findPath({x: rx, z: rz}, safe);
          if (p) this.path = p;
        }
        return;
      }
    }

    // 3. HUNT (Move towards player)
    this.aiState = 'HUNT';
    const p = this.findPath({x: rx, z: rz}, {x: playerX, z: playerZ});
    if (p && p.length > 1) {
      this.path = p.slice(0, 3); // Stream up to 3 points to avoid stopping
    } else {
      const neighbor = this.getRandomNeighborCell();
      if (neighbor) this.path = [neighbor];
    }
  }

  followPath(dt) {
    if (this.path.length === 0) return;
    
    let moveDist = this.speed * dt;
    while (moveDist > 0 && this.path.length > 0) {
      const target = this.path[0];
      const dx = target.x - this.position.x;
      const dz = target.z - this.position.z;
      const distToTarget = Math.sqrt(dx * dx + dz * dz);

      if (moveDist >= distToTarget) {
        this.position.x = target.x;
        this.position.z = target.z;
        this.path.shift();
        moveDist -= distToTarget;
      } else {
        const ratio = moveDist / distToTarget;
        this.position.x += dx * ratio;
        this.position.z += dz * ratio;
        this.targetRotation = Math.atan2(dx, dz);
        moveDist = 0;
      }
    }

    this.mesh.position.copy(this.position);
    
    let diff = this.targetRotation - this.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.mesh.rotation.y += diff * dt * 10;
  }

  findPath(start, end) {
    const queue = [[start]];
    const visited = new Set();
    visited.add(`${start.x},${start.z}`);

    while (queue.length > 0) {
      const path = queue.shift();
      const curr = path[path.length - 1];

      if (curr.x === end.x && curr.z === end.z) {
        return path.slice(1);
      }

      const neighbors = [
        { x: curr.x + 1, z: curr.z }, { x: curr.x - 1, z: curr.z },
        { x: curr.x, z: curr.z + 1 }, { x: curr.x, z: curr.z - 1 }
      ].filter(n => !checkCollision(n.x, n.z, this) || (n.x === end.x && n.z === end.z));

      for (const n of neighbors) {
        const key = `${n.x},${n.z}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push([...path, n]);
        }
      }
    }
    return null;
  }

  canEscapeAfterBomb(bx, bz) {
    const virtualBomb = { mesh: { position: { x: bx, z: bz } } };
    gameState.bombs.push(virtualBomb);
    const safeCell = this.findSafeCell();
    gameState.bombs.pop();
    
    // Require at least 2 steps to safety for a secure escape
    return safeCell !== null && safeCell.dist >= 2;
  }

  isCellInDanger(x, z) {
    return gameState.bombs.some(bomb => {
      const bx = Math.round(bomb.mesh.position.x);
      const bz = Math.round(bomb.mesh.position.z);
      if (bx === x && Math.abs(bz - z) <= EXPLOSION_RADIUS) return true;
      if (bz === z && Math.abs(bx - x) <= EXPLOSION_RADIUS) return true;
      return false;
    });
  }

  findSafeCell() {
    const rx = Math.round(this.position.x);
    const rz = Math.round(this.position.z);
    const queue = [{ x: rx, z: rz, dist: 0 }];
    const visited = new Set();
    
    while (queue.length > 0) {
      const curr = queue.shift();
      const key = `${curr.x},${curr.z}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (!this.isCellInDanger(curr.x, curr.z)) {
        return { x: curr.x, z: curr.z, dist: curr.dist };
      }

      if (curr.dist < 8) {
        const neighbors = [
          { x: curr.x + 1, z: curr.z }, { x: curr.x - 1, z: curr.z },
          { x: curr.x, z: curr.z + 1 }, { x: curr.x, z: curr.z - 1 }
        ].filter(c => !checkCollision(c.x, c.z, this));
        
        for (const n of neighbors) {
          queue.push({ ...n, dist: curr.dist + 1 });
        }
      }
    }
    return null;
  }

  getRandomNeighborCell() {
    const rx = Math.round(this.position.x);
    const rz = Math.round(this.position.z);
    const neighbors = [
      { x: rx + 1, z: rz }, { x: rx - 1, z: rz },
      { x: rx, z: rz + 1 }, { x: rx, z: rz - 1 }
    ].filter(c => !checkCollision(c.x, c.z, this));
    return neighbors.length > 0 ? neighbors[Math.floor(Math.random() * neighbors.length)] : null;
  }
}

// ─── World Building ──────────────────────────────────
function setupLevel() {
  // Clear scene
  gameState.walls.forEach(w => scene.remove(w));
  gameState.walls = [];
  
  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_SIZE + 2, GRID_SIZE + 2),
    new THREE.MeshStandardMaterial({ 
      map: grassTex,
      roughness: 0.9 
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Materials
  const wallGeo = new THREE.BoxGeometry(CELL_SIZE * 0.95, CELL_SIZE * 0.6, CELL_SIZE * 0.95);
  const wallMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.7, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ map: trimTex, roughness: 0.5, metalness: 0.2 });

  // Material Arrays: [posX, negX, posY, negY, posZ, negZ]
  // Top is index 2 (posY)
  const multiWallMat = [
    wallMat, wallMat, trimMat, wallMat, wallMat, wallMat
  ];

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (x % 2 === 0 && z % 2 === 0) {
        // Skip player and enemy start corners
        if ((x <= 1 && z <= 1) || (x >= GRID_SIZE - 2 && z >= GRID_SIZE - 2)) continue;
        
        const wall = new THREE.Mesh(wallGeo, multiWallMat);
        wall.position.set(x - HALF_GRID, CELL_SIZE * 0.3, z - HALF_GRID);
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
        gameState.walls.push(wall.position);
      }
    }
  }

  // Border Walls
  const borderGeo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE * 0.75, CELL_SIZE);
  const multiBorderMat = [
    wallMat, wallMat, trimMat, wallMat, wallMat, wallMat
  ];

  for (let i = -HALF_GRID - 1; i <= HALF_GRID + 1; i++) {
    for (const side of [-HALF_GRID - 1, HALF_GRID + 1]) {
      const w1 = new THREE.Mesh(borderGeo, multiBorderMat);
      w1.position.set(i, 0.375, side);
      w1.castShadow = true;
      w1.receiveShadow = true;
      scene.add(w1);
      gameState.walls.push(w1.position);

      const w2 = new THREE.Mesh(borderGeo, multiBorderMat);
      w2.position.set(side, 0.375, i);
      w2.castShadow = true;
      w2.receiveShadow = true;
      scene.add(w2);
      gameState.walls.push(w2.position);
    }
  }
}

function checkCollision(x, z, entity = null) {
  const rx = Math.round(x);
  const rz = Math.round(z);
  
  // Wall collision
  const hitWall = gameState.walls.some(w => Math.round(w.x) === rx && Math.round(w.z) === rz);
  if (hitWall) return true;

  // Bomb collision
  const hitBomb = gameState.bombs.some(b => {
    // If the entity is in the ghosting list, ignore the collision
    if (entity && b.walkableFor && b.walkableFor.has(entity)) return false;

    const bx = Math.round(b.mesh.position.x);
    const bz = Math.round(b.mesh.position.z);
    return bx === rx && bz === rz;
  });
  
  return hitBomb;
}

// ─── Bomb Logic ──────────────────────────────────────
let bombTemplate = null;
gltfLoader.load('/models/bomb.glb', (gltf) => {
  bombTemplate = gltf.scene;
  bombTemplate.scale.setScalar(0.27); // Scaled down by 1.5x (0.4 * 0.67)
  
  // Calculate actual height for positioning
  const box = new THREE.Box3().setFromObject(bombTemplate);
  const size = box.getSize(new THREE.Vector3());
  bombTemplate.userData.height = size.y;
});

function placeBomb(owner) {
  if (!bombTemplate) return;
  const bx = Math.round(owner.position.x);
  const bz = Math.round(owner.position.z);

  if (gameState.bombs.some(b => Math.round(b.mesh.position.x) === bx && Math.round(b.mesh.position.z) === bz)) return;

  const mesh = bombTemplate.clone();
  // Position Y based on half height so base touches the floor
  mesh.position.set(bx, bombTemplate.userData.height / 2, bz);
  scene.add(mesh);

  // Add PointLight (Flickering Light)
  const light = new THREE.PointLight(0xffaa00, 1, 2);
  light.position.y = bombTemplate.userData.height / 2;
  mesh.add(light);

  // Add Particles (Sparking Fuse)
  const sparkCount = 30;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(sparkCount * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ 
    color: 0xffaa00, 
    size: 0.1, 
    transparent: true, 
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.position.y = bombTemplate.userData.height / 2;
  mesh.add(sparks);

  const particles = [];
  for (let i = 0; i < sparkCount; i++) {
    particles.push({
      x: 0, y: 0, z: 0,
      vx: (Math.random() - 0.5) * 2,
      vy: Math.random() * 2 + 1,
      vz: (Math.random() - 0.5) * 2,
      life: Math.random() // Start staggered
    });
  }

  const bomb = { 
    mesh, 
    timer: BOMB_TIMER, 
    owner,
    walkableFor: new Set([owner]),
    light,
    sparks,
    particles
  };
  gameState.bombs.push(bomb);

  setTimeout(() => explode(bomb), BOMB_TIMER);

  // Play placement sound
  if (gameState.audio.unlocked && gameState.audio.sfx.place) {
    if (gameState.audio.sfx.place.isPlaying) gameState.audio.sfx.place.stop();
    gameState.audio.sfx.place.play();
  }
}

function explode(bomb) {
  const index = gameState.bombs.indexOf(bomb);
  if (index > -1) gameState.bombs.splice(index, 1);
  
  // Cleanup VFX Memory
  if (bomb.sparks) {
    bomb.sparks.geometry.dispose();
    bomb.sparks.material.dispose();
  }
  scene.remove(bomb.mesh);

  const bx = Math.round(bomb.mesh.position.x);
  const bz = Math.round(bomb.mesh.position.z);

  createExplosionVFX(bx, bz);

  // Play explosion sound (positional)
  playExplosionSound(bomb.mesh.position);

  // Damage check
  const affectedCells = [{ x: bx, z: bz }];
  const dirs = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  
  dirs.forEach(dir => {
    for (let i = 1; i <= EXPLOSION_RADIUS; i++) {
      const cx = bx + dir.x * i;
      const cz = bz + dir.z * i;
      if (gameState.walls.some(w => Math.round(w.x) === cx && Math.round(w.z) === cz)) break;
      affectedCells.push({ x: cx, z: cz });
    }
  });

  // Check entities
  [player, enemy].forEach(ent => {
    const ex = Math.round(ent.position.x);
    const ez = Math.round(ent.position.z);
    if (affectedCells.some(c => c.x === ex && c.z === ez)) {
      ent.takeDamage();
    }
  });
}

function updateBombsVFX(dt) {
  gameState.bombs.forEach(bomb => {
    // Decrease timer for math (actual explosion uses setTimeout)
    bomb.timer -= dt * 1000;
    const timeRatio = Math.max(0, bomb.timer / BOMB_TIMER);

    // 1. Pulsation Math
    // Slower base frequency (~1.5 cycles/sec), accelerating drastically in the last 30%
    let freq = Math.PI * 3; 
    if (timeRatio < 0.3) {
      freq += (0.3 - timeRatio) * 100; 
    }
    
    // Accumulate phase to prevent jumping artifacts when frequency changes
    bomb.pulsePhase = (bomb.pulsePhase || 0) + freq * dt;
    
    // Reduced amplitude for a natural "breathing" effect (0.95x to 1.05x)
    const scaleModifier = 1.0 + Math.sin(bomb.pulsePhase) * 0.05;
    bomb.mesh.scale.setScalar(0.27 * scaleModifier);

    // 2. Flickering Light
    bomb.light.intensity = 0.8 + Math.random() * 0.7;

    // 3. Spark Particles
    const posAttribute = bomb.sparks.geometry.attributes.position;
    for (let i = 0; i < bomb.particles.length; i++) {
      let p = bomb.particles[i];
      p.life += dt * 2;
      
      if (p.life > 1) {
        // Reset particle to top of bomb
        p.life = 0;
        p.x = 0;
        p.y = 0;
        p.z = 0;
        p.vx = (Math.random() - 0.5) * 1.5;
        p.vy = Math.random() * 2 + 1;
        p.vz = (Math.random() - 0.5) * 1.5;
      } else {
        // Move particle
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 5 * dt; // Gravity
      }

      posAttribute.setXYZ(i, p.x, p.y, p.z);
    }
    posAttribute.needsUpdate = true;
  });
}

let fireTexture = null;
function getFireTexture() {
  if (fireTexture) return fireTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.00, 'rgba(255, 255, 230, 1.0)');
  grad.addColorStop(0.18, 'rgba(255, 220, 90, 1.0)');
  grad.addColorStop(0.42, 'rgba(255, 120, 20, 0.85)');
  grad.addColorStop(0.72, 'rgba(180, 30, 0, 0.35)');
  grad.addColorStop(1.00, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  fireTexture = new THREE.CanvasTexture(canvas);
  return fireTexture;
}

function createExplosionVFX(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);

  const tex = getFireTexture();
  const material = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  const sprites = [];
  const dirs = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
  dirs.forEach(d => {
    for (let i = (d.x === 0 && d.z === 0 ? 0 : 1); i <= EXPLOSION_RADIUS; i++) {
      const cx = d.x * i;
      const cz = d.z * i;
      if (gameState.walls.some(w => Math.round(w.x) === (x + cx) && Math.round(w.z) === (z + cz))) break;

      const flamesPerCell = 7;
      for (let k = 0; k < flamesPerCell; k++) {
        const sprite = new THREE.Sprite(material);
        const jitter = 0.35;
        sprite.position.set(
          cx + (Math.random() - 0.5) * jitter,
          0.25 + Math.random() * 0.35,
          cz + (Math.random() - 0.5) * jitter
        );
        sprite.userData = {
          baseScale: 0.9 + Math.random() * 0.7,
          driftY: 1.0 + Math.random() * 1.2,
          seed: Math.random() * Math.PI * 2,
        };
        sprite.scale.setScalar(0.01);
        group.add(sprite);
        sprites.push(sprite);
      }
    }
  });

  const light = new THREE.PointLight(0xff7722, 8, 6, 2);
  light.position.y = 0.8;
  group.add(light);

  gameState.explosions.push({
    group,
    sprites,
    material,
    light,
    elapsed: 0,
    duration: EXPLOSION_DURATION / 1000,
  });
}

function updateExplosions(dt) {
  for (let i = gameState.explosions.length - 1; i >= 0; i--) {
    const ex = gameState.explosions[i];
    ex.elapsed += dt;
    const t = ex.elapsed / ex.duration;

    if (t >= 1) {
      scene.remove(ex.group);
      ex.material.dispose();
      gameState.explosions.splice(i, 1);
      continue;
    }

    const growT = Math.min(1, t / 0.15);
    const fadeT = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
    ex.material.opacity = fadeT;

    ex.sprites.forEach(sp => {
      const flicker = 0.9 + 0.1 * Math.sin(ex.elapsed * 25 + sp.userData.seed);
      sp.scale.setScalar(sp.userData.baseScale * growT * flicker);
      sp.position.y += sp.userData.driftY * dt * (1 - t);
    });

    ex.light.intensity = (8 + Math.random() * 3) * (1 - t);
  }
}

// ─── Game Management ─────────────────────────────────
let player, enemy;

function init() {
  setupLevel();

  player = new Player(new THREE.Vector3(-HALF_GRID, 0, -HALF_GRID));
  player.loadModel('/models/player.glb', 0.5, () => {
    player.updateHUD();
    checkAllLoaded();
  });

  enemy = new Enemy(new THREE.Vector3(HALF_GRID, 0, HALF_GRID));
  enemy.loadModel('/models/enemy.glb', 0.5, checkAllLoaded);

  // Lights: Sunny solar theme
  const amb = new THREE.AmbientLight(0xfff5e6, 0.5); // Warm ambient
  scene.add(amb);
  
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-15, 20, 10);
  sun.castShadow = true;
  sun.shadow.camera.left = -15;
  sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 15;
  sun.shadow.camera.bottom = -15;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // Audio setup
  loadAudioAssets();

  // Unlock audio on first interaction
  const unlocker = () => {
    if (gameState.audio.unlocked) return;
    gameState.audio.unlocked = true;
    if (gameState.audio.bgm) {
      gameState.audio.bgm.play();
    }
    // Resume AudioContext if suspended
    if (listener.context.state === 'suspended') {
      listener.context.resume();
    }
    window.removeEventListener('click', unlocker);
    window.removeEventListener('keydown', unlocker);
    window.removeEventListener('touchstart', unlocker);
  };
  window.addEventListener('click', unlocker);
  window.addEventListener('keydown', unlocker);
  window.addEventListener('touchstart', unlocker, { passive: true });

  // OrbitControls setup
  setupControls();

  // Mobile touch controls
  setupTouchControls();
}

function setupTouchControls() {
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches
    || 'ontouchstart' in window
    || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch-device');

  const fireKey = (type, code) => {
    window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  };

  // D-pad: hold = key down, release = key up
  document.querySelectorAll('.dpad-btn').forEach(btn => {
    const code = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      btn.classList.add('active');
      fireKey('keydown', code);
      if (btn.setPointerCapture && e.pointerId != null) {
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      }
    };
    const release = (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      fireKey('keyup', code);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', (e) => {
      if (btn.classList.contains('active')) release(e);
    });
    // Prevent iOS context menu / callout
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // Bomb button: tap fires a single Space keydown (existing handler places a bomb)
  const bombBtn = document.getElementById('touch-bomb');
  if (bombBtn) {
    const tap = (e) => {
      e.preventDefault();
      bombBtn.classList.add('active');
      fireKey('keydown', 'Space');
      fireKey('keyup', 'Space');
      setTimeout(() => bombBtn.classList.remove('active'), 120);
    };
    bombBtn.addEventListener('pointerdown', tap);
    bombBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

let controls;
function setupControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0); // Center of the board
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  
  // Constraints
  controls.minDistance = 5;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.47; // Stay above ground
  controls.minPolarAngle = Math.PI * 0.1;  // Don't go strictly top-down
  
  controls.update();

  // Reset initial camera for isometric view (matching reference)
  camera.position.set(0, 10, 12);
  controls.update();
}

function loadAudioAssets() {
  // Background Music
  audioLoader.load('/audio/background_music.mp3', (buffer) => {
    const bgm = new THREE.Audio(listener);
    bgm.setBuffer(buffer);
    bgm.setLoop(true);
    bgm.setVolume(0.3);
    gameState.audio.bgm = bgm;
  });

  // Bomb Place SFX
  audioLoader.load('/audio/bomb_place.mp3', (buffer) => {
    const sound = new THREE.Audio(listener);
    sound.setBuffer(buffer);
    sound.setVolume(0.5);
    gameState.audio.sfx.place = sound;
  });

  // Explosion SFX Pool
  audioLoader.load('/audio/explosion.mp3', (buffer) => {
    // We'll store the buffer and create PositionalAudio on demand
    gameState.audio.sfx.explodeBuffer = buffer;
  });
}

function playExplosionSound(position) {
  if (!gameState.audio.unlocked || !gameState.audio.sfx.explodeBuffer) return;

  const sound = new THREE.PositionalAudio(listener);
  sound.setBuffer(gameState.audio.sfx.explodeBuffer);
  sound.setRefDistance(5);
  sound.setVolume(1.0);
  
  // Create a temporary mesh to hold the positional audio at the explosion site
  const audioMesh = new THREE.Object3D();
  audioMesh.position.copy(position);
  scene.add(audioMesh);
  audioMesh.add(sound);

  sound.play();

  // Cleanup after sound finishes
  sound.onEnded = () => {
    audioMesh.remove(sound);
    scene.remove(audioMesh);
  };
}

function checkAllLoaded() {
  if (player.mesh && enemy.mesh) {
    loadingScreen.classList.add('hidden');
    hud.classList.add('visible');
    gameState.levelLoaded = true;
  }
}

function checkGameOver() {
  if (player.isDead) {
    showOverlay('GAME OVER', 'You were defeated by the enemy!');
  } else if (enemy.isDead) {
    showOverlay('VICTORY!', 'You have eliminated the enemy!');
  }
}

function showOverlay(title, msg) {
  gameState.isGameOver = true;
  gameOverTitle.textContent = title;
  gameOverMessage.textContent = msg;
  gameOverOverlay.classList.remove('hidden');
}

function restartGame() {
  location.reload(); // Simple way to reset everything
}

restartBtn.addEventListener('click', restartGame);

// ─── Main Loop ───────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (gameState.levelLoaded && !gameState.isPaused) {
    player.update(dt);
    enemy.update(dt);

    // Update bombs ghosting state
    updateBombsGhosting();

    // Update Bomb VFX
    updateBombsVFX(dt);

    // Update Explosion VFX
    updateExplosions(dt);

    // Update controls for damping
    if (controls) controls.update();
  }

  renderer.render(scene, camera);
}

// ─── Responsive ──────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
animate();

function updateBombsGhosting() {
  gameState.bombs.forEach(bomb => {
    if (!bomb.walkableFor) return;
    
    const bx = Math.round(bomb.mesh.position.x);
    const bz = Math.round(bomb.mesh.position.z);
    
    // Check each entity currently allowed to walk through this bomb
    bomb.walkableFor.forEach(ent => {
      const ex = Math.round(ent.position.x);
      const ez = Math.round(ent.position.z);
      
      // If the entity has moved out of the bomb's cell, it can no longer walk through it
      if (ex !== bx || ez !== bz) {
        bomb.walkableFor.delete(ent);
      }
    });
  });
}
