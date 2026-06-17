    import * as THREE from "https://unpkg.com/three@0.160.1/build/three.module.js";
    import { OrbitControls } from "https://unpkg.com/three@0.160.1/examples/jsm/controls/OrbitControls.js";
    import { SVGLoader } from "https://unpkg.com/three@0.160.1/examples/jsm/loaders/SVGLoader.js";

    const container = document.getElementById("hallway-3d-root");
    const statusEl = document.getElementById("hallway-3d-status");

    if (!container) throw new Error("Missing container");

    /* -----------------------------
    SCENE
    ----------------------------- */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10131a);

    /* -----------------------------
    CAMERA
    ----------------------------- */
    const camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        20000
    );
    camera.position.set(200, 200, 200);

    /* -----------------------------
    RENDERER
    ----------------------------- */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    /* -----------------------------
    CONTROLS
    ----------------------------- */
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    /* -----------------------------
    LIGHTS
    ----------------------------- */
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(200, 300, 200);
    scene.add(light);

    /* -----------------------------
    GRID
    ----------------------------- */
    scene.add(new THREE.GridHelper(2000, 60, 0x2b3850, 0x1c2535));

    /* -----------------------------
    ROOT
    ----------------------------- */
    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    /* -----------------------------
    🧱 SIMPLE HALLWAY (NEW)
    ----------------------------- */
        function createSimpleHallway() {
            const group = new THREE.Group();

            const wallMaterial = new THREE.MeshStandardMaterial({
                color: 0x2ee6ff,
                roughness: 0.8
            });

            const floorMaterial = new THREE.MeshStandardMaterial({
                color: 0x1a1f2a,
                roughness: 1
            });

            /* FLOOR */
            const floor = new THREE.Mesh(
                new THREE.BoxGeometry(300, 2, 60),
                floorMaterial
            );
            floor.position.y = 0;
            group.add(floor);

            /* LEFT WALL */
            const leftWall = new THREE.Mesh(
                new THREE.BoxGeometry(300, 40, 2),
                wallMaterial
            );
            leftWall.position.set(0, 20, -30);
            group.add(leftWall);

            /* RIGHT WALL */
            const rightWall = new THREE.Mesh(
                new THREE.BoxGeometry(300, 40, 2),
                wallMaterial
            );
            rightWall.position.set(0, 20, 30);
            group.add(rightWall);

            /* END WALL */
            const endWall = new THREE.Mesh(
                new THREE.BoxGeometry(2, 40, 60),
                wallMaterial
            );
            endWall.position.set(150, 20, 0);
            group.add(endWall);

            return group;
        }

    /* add hallway first */
    const hallway = createSimpleHallway();
    scene.add(hallway);

    /* -----------------------------
    STATUS
    ----------------------------- */
    function updateStatus(msg) {
        if (statusEl) statusEl.textContent = msg;
    }

    /* -----------------------------
    RESIZE
    ----------------------------- */
    function onResize() {
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;

        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
    }
    window.addEventListener("resize", onResize);

    /* -----------------------------
    CAMERA FRAME
    ----------------------------- */
    function frameModel(object) {
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        object.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = maxDim * 2;

        camera.position.set(dist, dist, dist);
        camera.lookAt(0, 0, 0);

        controls.target.set(0, 0, 0);
        controls.update();
    }

    /* -----------------------------
    SVG LOAD
    ----------------------------- */
    async function loadHallwaySvg() {
        updateStatus("Loading SVG...");

        const response = await fetch("/static/testhallway.svg");
        const svgText = await response.text();

        const loader = new SVGLoader();
        const svgData = loader.parse(svgText);

        let meshCount = 0;
        const wallHeight = 40;

        for (const path of svgData.paths) {
            const shapes = SVGLoader.createShapes(path);

            const material = new THREE.MeshStandardMaterial({
                color: path.color ? new THREE.Color(path.color) : 0x2ee6ff,
                roughness: 0.85
            });

            for (const shape of shapes) {
                const geometry = new THREE.ExtrudeGeometry(shape, {
                    depth: wallHeight,
                    bevelEnabled: false
                });

                geometry.rotateX(-Math.PI / 2);

                const mesh = new THREE.Mesh(geometry, material);
                modelRoot.add(mesh);
                meshCount++;
            }
        }

        console.log("SVG MESHES:", meshCount);

        frameModel(modelRoot);

        updateStatus(`SVG Loaded (${meshCount} meshes) + hallway active`);
    }

    /* -----------------------------
    LOOP
    ----------------------------- */
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    /* -----------------------------
    BOOT
    ----------------------------- */
    (async function boot() {
        try {
            onResize();
            await loadHallwaySvg();
            animate();
        } catch (err) {
            console.error(err);
            updateStatus(err.message);
        }
    })();