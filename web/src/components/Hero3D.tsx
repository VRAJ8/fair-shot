// Tip-off scene: a basketball drops into a spotlight on a hardwood court.
// Scrolling through the hero flies the camera up into an overhead view.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Sparkles } from '@react-three/drei'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { gsap, reducedMotion } from '../lib/motion'
import { basketballTextures, courtTexture } from './textures'

const BALL_R = 0.62

function Ball({ progress }: { progress: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null!)
  const mesh = useRef<THREE.Mesh>(null!)
  const { map, bumpMap } = useMemo(() => basketballTextures(), [])
  useEffect(() => {
    if (reducedMotion) { group.current.position.y = BALL_R; return }
    const tl = gsap.timeline({ delay: 0.25 })
    group.current.position.y = 7
    tl.to(group.current.position, { y: BALL_R, duration: 2.1, ease: 'bounce.out' })
    tl.fromTo(mesh.current.rotation, { x: -2 }, { x: 0.4, duration: 2.4, ease: 'power2.out' }, 0)
    return () => { tl.kill() }
  }, [])
  useFrame((_, dt) => {
    // a slow spin, and the ball rolls toward the center circle as you scroll
    mesh.current.rotation.y += dt * 0.35
    const p = progress.current
    group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, -p * 2.2, 0.08)
    mesh.current.rotation.z = -group.current.position.x / BALL_R
  })
  return (
    <group ref={group} position={[0, 7, 0]}>
      <mesh ref={mesh} castShadow>
        <sphereGeometry args={[BALL_R, 96, 96]} />
        <meshStandardMaterial map={map} bumpMap={bumpMap} bumpScale={0.6} roughness={0.72} metalness={0.02} />
      </mesh>
    </group>
  )
}

function Court() {
  const tex = useMemo(() => courtTexture(), [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[18.8, 10]} />
      <meshStandardMaterial map={tex} roughness={0.38} metalness={0.05} />
    </mesh>
  )
}

function CameraRig({ progress }: { progress: MutableRefObject<number> }) {
  const { camera, pointer } = useThree()
  const look = useRef(new THREE.Vector3(0, BALL_R, 0))
  useFrame(() => {
    const p = THREE.MathUtils.smoothstep(progress.current, 0, 1)
    const target = new THREE.Vector3(
      THREE.MathUtils.lerp(0.4, 0, p) + pointer.x * 0.35,
      THREE.MathUtils.lerp(1.25, 10.5, p) + pointer.y * 0.2,
      THREE.MathUtils.lerp(4.4, 4.2, p),
    )
    camera.position.lerp(target, 0.07)
    look.current.lerp(new THREE.Vector3(THREE.MathUtils.lerp(0, -0.6, p), THREE.MathUtils.lerp(BALL_R * 0.9, 0, p), 0), 0.07)
    camera.lookAt(look.current)
  })
  return null
}

export default function Hero3D({ progress }: { progress: MutableRefObject<number> }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0.4, 1.25, 4.4], fov: 42, near: 0.1, far: 60 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#0b0d12')
        scene.fog = new THREE.Fog('#0b0d12', 6, 17)
      }}
    >
      <ambientLight intensity={0.16} />
      <spotLight
        position={[0.6, 9, 2.2]} angle={0.42} penumbra={0.75} intensity={420} distance={30} decay={2}
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} color="#ffe2bd"
      />
      <pointLight position={[-6, 3, -4]} intensity={30} color="#3d8fe8" />
      <pointLight position={[6, 2, -3]} intensity={26} color="#e8681f" />
      <Court />
      <Ball progress={progress} />
      <ContactShadows position={[0, 0.005, 0]} opacity={0.55} scale={6} blur={2.4} far={2} />
      <Sparkles count={70} scale={[6, 5, 4]} position={[0, 3, 0]} size={2.2} speed={0.25} opacity={0.45} color="#ffd7a3" />
      <CameraRig progress={progress} />
    </Canvas>
  )
}
