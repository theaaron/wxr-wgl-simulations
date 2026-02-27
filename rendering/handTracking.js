import { setHandGrabState, updateHandControllerPose, updateStructureManipulation } from './vrControllers.js';

const PINCH_THRESHOLD = 0.025;
const PINCH_RELEASE = 0.045;
const TAP_DISTANCE_THRESHOLD = 0.04; // fingertip must be this close to voxel surface (meters)
const TAP_COOLDOWN_MS = 400;
const PANEL_POKE_DEPTH = 0.02; // how close finger must be to panel plane (meters)
const PANEL_POKE_COOLDOWN_MS = 500;

const THUMB_TIP = 'thumb-tip';
const INDEX_TIP = 'index-finger-tip';
const INDEX_DISTAL = 'index-finger-phalanx-distal';
const WRIST = 'wrist';

let leftPinching = false;
let rightPinching = false;
let handsSupported = false;

let leftFingerRay = null;
let rightFingerRay = null;

let leftTapState = { wasTouching: false, lastTapTime: 0, pickRequested: false, pickedVoxel: null };
let rightTapState = { wasTouching: false, lastTapTime: 0, pickRequested: false, pickedVoxel: null };

let leftPanelPoke = { wasPoking: false, lastPokeTime: 0, pokeRequested: false };
let rightPanelPoke = { wasPoking: false, lastPokeTime: 0, pokeRequested: false };

function jointPos(frame, referenceSpace, inputSource, jointName) {
    if (!inputSource.hand) return null;
    const joint = inputSource.hand.get(jointName);
    if (!joint) return null;
    const pose = frame.getJointPose(joint, referenceSpace);
    if (!pose) return null;
    return pose.transform;
}

function dist(a, b) {
    const dx = a.position.x - b.position.x;
    const dy = a.position.y - b.position.y;
    const dz = a.position.z - b.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function midpoint(tA, tB) {
    return {
        x: (tA.position.x + tB.position.x) * 0.5,
        y: (tA.position.y + tB.position.y) * 0.5,
        z: (tA.position.z + tB.position.z) * 0.5,
    };
}

function buildFingerMatrix(tipPos, fingerDirection) {
    const fwd = fingerDirection;

    let upRef = [0, 1, 0];
    if (Math.abs(fwd.y) > 0.99) upRef = [0, 0, 1];

    // right = forward x up
    let rx = fwd.y * upRef[2] - fwd.z * upRef[1];
    let ry = fwd.z * upRef[0] - fwd.x * upRef[2];
    let rz = fwd.x * upRef[1] - fwd.y * upRef[0];
    const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (rLen < 0.001) return null;
    rx /= rLen; ry /= rLen; rz /= rLen;

    // up = right x forward
    const ux = ry * fwd.z - rz * fwd.y;
    const uy = rz * fwd.x - rx * fwd.z;
    const uz = rx * fwd.y - ry * fwd.x;

    return new Float32Array([
        rx, ry, rz, 0,
        ux, uy, uz, 0,
        -fwd.x, -fwd.y, -fwd.z, 0,
        tipPos.x, tipPos.y, tipPos.z, 1
    ]);
}

export function updateHandTracking(frame, referenceSpace) {
    if (!frame || !referenceSpace) return;

    let sawHand = false;

    for (const inputSource of frame.session.inputSources) {
        if (!inputSource.hand) continue;
        sawHand = true;
        handsSupported = true;

        const hand = inputSource.handedness;
        const thumbTip = jointPos(frame, referenceSpace, inputSource, THUMB_TIP);
        const indexTip = jointPos(frame, referenceSpace, inputSource, INDEX_TIP);
        const indexDistal = jointPos(frame, referenceSpace, inputSource, INDEX_DISTAL);
        const wrist = jointPos(frame, referenceSpace, inputSource, WRIST);

        if (!thumbTip || !indexTip || !wrist) continue;

        // --- Pinch detection (for grab) ---
        const pinchDist = dist(thumbTip, indexTip);
        const wasPinching = hand === 'left' ? leftPinching : rightPinching;
        const pinch = wasPinching
            ? pinchDist < PINCH_RELEASE
            : pinchDist < PINCH_THRESHOLD;

        if (hand === 'left') leftPinching = pinch;
        else rightPinching = pinch;

        const wristMatrix = wrist.matrix;
        const pinchOrigin = midpoint(thumbTip, indexTip);

        updateHandControllerPose(hand, wristMatrix);

        if (pinch && !wasPinching) {
            setHandGrabState(hand, true, wristMatrix, pinchOrigin);
        } else if (!pinch && wasPinching) {
            setHandGrabState(hand, false, null, null);
        }

        // --- Finger ray for poke/tap (only when NOT pinching) ---
        if (!pinch && indexDistal) {
            const tip = indexTip.position;
            const dis = indexDistal.position;

            const dx = tip.x - dis.x;
            const dy = tip.y - dis.y;
            const dz = tip.z - dis.z;
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (len > 0.001) {
                const direction = { x: dx / len, y: dy / len, z: dz / len };
                const matrix = buildFingerMatrix(tip, direction);

                if (matrix) {
                    const ray = { matrix, origin: { x: tip.x, y: tip.y, z: tip.z }, direction, handedness: hand };
                    if (hand === 'left') leftFingerRay = ray;
                    else rightFingerRay = ray;
                } else {
                    if (hand === 'left') leftFingerRay = null;
                    else rightFingerRay = null;
                }
            }
        } else {
            if (hand === 'left') leftFingerRay = null;
            else rightFingerRay = null;
        }
    }

    if (!sawHand && handsSupported) {
        if (leftPinching) { setHandGrabState('left', false, null, null); leftPinching = false; }
        if (rightPinching) { setHandGrabState('right', false, null, null); rightPinching = false; }
        leftFingerRay = null;
        rightFingerRay = null;
    }
}

export function processFingerPickResult(hand, pickResult) {
    const tapState = hand === 'left' ? leftTapState : rightTapState;
    const now = performance.now();

    const isTouching = pickResult !== null && pickResult.hitDistance < TAP_DISTANCE_THRESHOLD;

    if (isTouching && !tapState.wasTouching && (now - tapState.lastTapTime) > TAP_COOLDOWN_MS) {
        tapState.pickRequested = true;
        tapState.lastTapTime = now;
        tapState.pickedVoxel = pickResult;
    }

    tapState.wasTouching = isTouching;
}

export function processFingerPanelPoke(hand, buttonId) {
    const pokeState = hand === 'left' ? leftPanelPoke : rightPanelPoke;
    const now = performance.now();

    const isPoking = buttonId !== null;

    if (isPoking && !pokeState.wasPoking && (now - pokeState.lastPokeTime) > PANEL_POKE_COOLDOWN_MS) {
        pokeState.pokeRequested = true;
        pokeState.lastPokeTime = now;
    }

    pokeState.wasPoking = isPoking;
}

export function consumeFingerTap(hand) {
    const tapState = hand === 'left' ? leftTapState : rightTapState;
    if (tapState.pickRequested) {
        tapState.pickRequested = false;
        return tapState.pickedVoxel;
    }
    return null;
}

export function consumeFingerPanelPoke(hand) {
    const pokeState = hand === 'left' ? leftPanelPoke : rightPanelPoke;
    if (pokeState.pokeRequested) {
        pokeState.pokeRequested = false;
        return true;
    }
    return false;
}

export function getFingerRay(hand) {
    return hand === 'left' ? leftFingerRay : rightFingerRay;
}

export function isHandPinching(hand) {
    return hand === 'left' ? leftPinching : rightPinching;
}

export function isHandTrackingActive() {
    return handsSupported;
}
