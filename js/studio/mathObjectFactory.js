// studio/mathObjectFactory.js — parse text → Three.js object

export function createMathObject(spec, THREE, math) {
  const s = (spec || 'grid').trim().toLowerCase();
  const parts = s.split(/\s+/);
  const kind = parts[0];

  if (kind === 'grid') {
    const g = new THREE.Group();
    const grid = new THREE.GridHelper(6, 12, 0x4488ff, 0x334466);
    g.add(grid);
    const ax = new THREE.AxesHelper(3);
    g.add(ax);
    g.userData.update = () => {};
    return g;
  }

  if (kind === 'helix') {
    const r = parseFloat(parts.find((p) => p.startsWith('r='))?.slice(2) || '1');
    const turns = parseFloat(parts.find((p) => p.startsWith('turns='))?.slice(6) || '3');
    const pts = [];
    for (let t = 0; t <= turns * Math.PI * 2; t += 0.08) {
      pts.push(new THREE.Vector3(r * Math.cos(t), t * 0.15 - 1, r * Math.sin(t)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x44aaff }));
    line.userData.update = (t) => { line.rotation.y = t * Math.PI * 2; };
    return line;
  }

  if (kind === 'vector') {
    const nums = s.replace(/vector\s*/i, '').split(/[, ]+/).map(Number).filter((n) => !isNaN(n));
    const v = new THREE.Vector3(nums[0] || 1, nums[1] || 2, nums[2] || 1);
    const arr = new THREE.ArrowHelper(v.clone().normalize(), new THREE.Vector3(0, 0, 0), v.length() * 0.5, 0xff6644);
    arr.userData.update = () => {};
    return arr;
  }

  if (kind === 'rotate') {
    const shape = parts[1] || 'cube';
    let mesh;
    if (shape === 'sphere') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), new THREE.MeshPhongMaterial({ color: 0x66cc88 }));
    else mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshPhongMaterial({ color: 0x6688ff }));
    mesh.userData.update = (t) => { mesh.rotation.x = t * Math.PI * 2; mesh.rotation.y = t * Math.PI * 1.5; };
    return mesh;
  }

  if (kind === 'surface' || kind === 'plane') {
    const expr = s.replace(/^(surface|plane)\s*/i, '').replace(/^z\s*=\s*/i, '') || 'sin(x)*cos(y)';
    const geo = new THREE.PlaneGeometry(3, 3, 32, 32);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      let z = 0;
      try { z = math.evaluate(expr, { x, y }); } catch (_) { z = 0; }
      if (!isFinite(z)) z = 0;
      pos.setZ(i, z * 0.35);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x88aaff, wireframe: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.update = (t) => { mesh.rotation.z = t * 0.5; };
    return mesh;
  }

  return createMathObject('grid', THREE, math);
}
