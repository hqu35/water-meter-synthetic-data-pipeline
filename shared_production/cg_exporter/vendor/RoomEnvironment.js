import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RectAreaLight,
  Scene,
} from "./three.module.js";

// Minimal local RoomEnvironment addon compatible with the vendored Three.js
// build. It is used only as an invisible PMREM source for PBR reflections.
class RoomEnvironment extends Scene {
  constructor() {
    super();

    const room = new Mesh(
      new BoxGeometry(12, 9, 12),
      new MeshBasicMaterial({ color: 0xffffff, side: BackSide })
    );
    room.position.set(0, 0, 0);
    this.add(room);

    const floor = new Mesh(
      new PlaneGeometry(12, 12),
      new MeshStandardMaterial({ color: 0x8f9499, roughness: 0.45, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -4.48;
    this.add(floor);

    const key = new RectAreaLight(0xffffff, 9.5, 5.2, 3.8);
    key.position.set(-3.2, 3.4, 4.4);
    key.lookAt(0, 0, 0);
    this.add(key);

    const softbox = new RectAreaLight(0xdcecff, 4.2, 3.4, 2.6);
    softbox.position.set(3.4, 1.8, 3.2);
    softbox.lookAt(0, 0, 0);
    this.add(softbox);

    const rim = new RectAreaLight(0xffffff, 2.1, 5.6, 2.2);
    rim.position.set(0, 2.2, -4.6);
    rim.lookAt(0, 0, 0);
    this.add(rim);
  }
}

export { RoomEnvironment };
