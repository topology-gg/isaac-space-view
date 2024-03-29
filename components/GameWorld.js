import React, { Component, useState, useEffect, useRef, useMemo, useCallback } from "react";
import { fabric } from 'fabric';
import { BigNumber } from 'bignumber.js'

import {
    useStarknet,
    useContract,
    useStarknetCall,
    useStarknetInvoke
} from '@starknet-react/core'

import UniverseAbi from '../abi/universe_abi.json'
import {
    useMacroStates,
    useImpulses
} from '../lib/api'
import styles from "../styles/GameWorld.module.css"


const UNIVERSE_ADDR = '0x05538cf7d703fa3dccb61329d23598a6b31748c120c6fff0b7c48da2396ba104' // universe #0

function useUniverseContract() {
    return useContract({ abi: UniverseAbi, address: UNIVERSE_ADDR })
}

//
// Constants
//
const STARK_PRIME = new BigNumber('3618502788666131213697322783095070105623107215331596699973092056135872020481')
const STARK_PRIME_HALF = new BigNumber('1809251394333065606848661391547535052811553607665798349986546028067936010240')
const DT = 0.005 // from contract: DT = 5 * SCALE_FP_DIV_1000

function createPlnt (x, y, d, rotation, fill, stroke, stroke_w, cursor, opacity)
{
    var pos = fabric.util.rotatePoint(
        new fabric.Point(x, y),
        new fabric.Point(x + d/2, y + d/2),
        fabric.util.degreesToRadians(rotation)
    );

    return new fabric.Rect(
    {
        width: d,
        height: d,
        selectable: false,
        fill: fill,
        stroke: stroke,
        strokeWidth: stroke_w,
        left: pos.x,
        top: pos.y,
        angle: rotation,
        hoverCursor: cursor,
        opacity: opacity
    });
}

function createTriangle (x, y, w, h, rotation, stroke)
{
    var width  = w;
    var height = h;
    var pos = fabric.util.rotatePoint(
        new fabric.Point(x, y),
        new fabric.Point(x + width / 2, y + height / 3 * 2),
        fabric.util.degreesToRadians(rotation)
    );
    return new fabric.Triangle(
    {
        width: width,
        height: height,
        selectable: false,
        fill: stroke,
        stroke: stroke,
        strokeWidth: 1,
        left: pos.x,
        top: pos.y,
        angle: rotation,
        hoverCursor: 'default'
    });
}

function parse_phi_to_degree (phi)
{
    const phi_bn = new BigNumber(Buffer.from(phi, 'base64').toString('hex'), 16)
    const phi_degree = (phi_bn / 10**20) / (Math.PI * 2) * 360

    return phi_degree
}

// Renders a number to exponential notation in HTML
function renderExponential (num) {
    return num.toExponential(2).split('e').map((v, i) => i === 1 ? (<sup>{v}</sup>) : `${v}×10`)
}

export default function GameWorld() {

    const SUN0_RADIUS = 0.89 // from contract
    const SUN1_RADIUS = 1.36 // from contract
    const SUN2_RADIUS = 0.61 // from contract
    const PLNT_RADIUS = 0.03 // arbitrary

    const CANVAS_BG_LIGHT = '#f9ffff'
    const SUN0_FILL_LIGHT = '#f0e3d0'
    const SUN1_FILL_LIGHT = '#e3bab4'
    const SUN2_FILL_LIGHT = '#b9e3f3'

    const SUN0_TRAIL_FILL_LIGHT = '#f0e3d0'
    const SUN1_TRAIL_FILL_LIGHT = '#e3bab4'
    const SUN2_TRAIL_FILL_LIGHT = '#b9e3f3'

    // const EV_FILL_LIGHT = '#405566'
    const EV_FILL_LIGHT = '#7777AA'

    const CANVAS_BF_DARK = '#00202C'
    const SUN0_FILL_DARK = '#6289AF'
    const SUN1_FILL_DARK = '#FF8B58'
    const SUN2_FILL_DARK = '#A05760'
    const EV_FILL_DARK = '#8E8E8E'

    fabric.Object.prototype.selectable = false;

    // Credits:
    // https://aprilescobar.medium.com/part-1-fabric-js-on-react-fabric-canvas-e4094e4d0304
    // https://stackoverflow.com/questions/60723440/problem-in-attaching-event-to-canvas-in-useeffect
    // https://eliaslog.pw/how-to-add-multiple-refs-to-one-useref-hook/

    //
    // Logic to retrieve state from Starknet
    //
    const { contract } = useUniverseContract()
    const { account } = useStarknet()

    const { data: db_macro_states } = useMacroStates ()
    const { data: db_impulses } = useImpulses ()

    //
    // React states & refs
    //
    const [canvas, setCanvas] = useState([]);
    const [hasDrawn, _] = useState([]);
    const [universeAge, setUniverseAge] = useState ();
    const [windowDimensions, setWindowDimensions] = useState (getWindowDimensions());
    const [tooltip, setTooltip] = useState (false);
    const [showFaceAssist, setShowFaceAssist] = useState (false);

    const _canvasRef = useRef()
    const _hasDrawnRef = useRef(false)
    const tooltipRef = useRef(null)
    const sun0ImgRef = useRef(null)
    const sun1ImgRef = useRef(null)
    const sun2ImgRef = useRef(null)
    const plntRectRef = useRef(null)
    const ndpeLaunchGroupsRef = useRef(null) //  Refs for all the NDPE launch impulses
    const faceAssistObjsRef = useRef(null)
    const showFaceAssistRef = useRef (false)

    //
    // timer trick to tackle the font loading issue
    //
    const [timeLeft, setTimeLeft] = useState(2);
    const [imgVisibility, setImgVisibility] = useState('hidden');
    const intervalRef = useRef(); // Add a ref to store the interval id
    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setTimeLeft((t) => t - 1);
        }, 1000);
        return () => clearInterval(intervalRef.current);
    }, []);
    useEffect(() => {
        if (timeLeft <= 0) {
            clearInterval(intervalRef.current);
            console.log ('timer reached 0')
            setImgVisibility ('visible')
        }
    }, [timeLeft]);

    // When hovering over an NDPE impulse, calculate deltas to display
    let hoveredImpulseDelta, hoveredImpulseIndex, planetV, planetVRelChange
    if (tooltip && tooltip.startsWith('ndpeImpulse') && db_impulses.impulses.length) {
        hoveredImpulseIndex = parseInt(tooltip.split(',')[1])
        const impulse = db_impulses.impulses[hoveredImpulseIndex]
        const delta_vx = impulse.impulse_applied.x / (1e-4)
        const delta_vy = impulse.impulse_applied.y / (1e-4)
        hoveredImpulseDelta = { x: delta_vx, y: delta_vy }

        // Grab 2 macro states just before the impulse and calculate velocity
        if (db_macro_states.macro_states.length) {
            const closestIndex = db_macro_states.macro_states.findIndex((state) => state.block_number === impulse.block_number)
            const state0 = db_macro_states.macro_states[closestIndex]
            const state1 = db_macro_states.macro_states[closestIndex - 1]
            planetV = {
                x: (state0.dynamics.planet.q.x - state1.dynamics.planet.q.x)/DT, // divided by DT to get velocity component
                y: (state0.dynamics.planet.q.y - state1.dynamics.planet.q.y)/DT,
            }
            planetVRelChange = {
                x: planetV.x != 0 ? delta_vx / planetV.x : delta_vx * DT,
                y: planetV.y != 0 ? delta_vy / planetV.y : delta_vy * DT,
                x_from_0: planetV.x == 0,
                y_from_0: planetV.y == 0
            }
        }
    }

    const handleMouseOverTarget = useCallback((target) => {
        if (target && target !== _canvasRef.current) {
            if (target === sun0ImgRef.current) {
                setTooltip("ORTA")
            } else if (target === sun1ImgRef.current) {
                setTooltip("BÖYÜK")
            } else if (target === sun2ImgRef.current) {
                setTooltip("BALACA")
            } else if (target === plntRectRef.current) {
                setTooltip("Ev")
            } else {
                const ndpeIndex = ndpeLaunchGroupsRef.current?.indexOf(target)
                if (ndpeLaunchGroupsRef.current && ndpeIndex !== -1) {
                    setTooltip(`ndpeImpulse,${ndpeIndex}`)
                }
            }
        }
    }, []);

    const handleMouseOutTarget = useCallback((target) => {
        setTooltip (false)
    }, []);

    function handleKeyDown (target) {
        if (!faceAssistObjsRef.current) return;
        if (target.key == 'q') {
            const visible = !showFaceAssistRef.current
            showFaceAssistRef.current = visible
            setShowFaceAssist (visible)
            for (const obj of faceAssistObjsRef.current) {
                obj.visible = visible
                obj.dirty = true
            }
            _canvasRef.current.requestRenderAll ()
        }
    }

    //
    // main hooks to initialize canvas and draw everything conditioned on db loaded and font-loading timer expired
    //
    useEffect (() => {
        _canvasRef.current = new fabric.Canvas('c', {
            height: 1500,
            width: 1500,
            backgroundColor: CANVAS_BG_LIGHT,
            selection: false
        })
        _hasDrawnRef.current = false

        _canvasRef.current.on("mouse:over", function(e) {
            handleMouseOverTarget(e.target)
        })
        _canvasRef.current.on("mouse:out", function(e) {
            handleMouseOutTarget(e.target)
        })
        document.addEventListener("keydown", handleKeyDown, false);

        return () => {
            _canvasRef.current.dispose()
            document.removeEventListener("keydown", handleKeyDown, false);
        }
    }, [handleMouseOverTarget, handleMouseOutTarget]);

    useEffect (() => {
        if (!db_macro_states || !db_impulses) {
            return
        }
        else if (timeLeft > 0) {
            return
        }
        else {
            // clear and redraw all objects on canvas
            _canvasRef.current.remove(..._canvasRef.current.getObjects())
            drawWorld (_canvasRef.current)
        }
        // else if (!_hasDrawnRef.current) {
        //     console.log ('lets draw world')
        //     drawWorld (_canvasRef.current)
        // }
    }, [db_macro_states, db_impulses, timeLeft]);

    useEffect(() => {
        function handleResize() {
            setWindowDimensions (getWindowDimensions());
        }

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const drawWorld = canvi => {
        console.log ('macro_states:', db_macro_states.macro_states)
        console.log ('impulses:', db_impulses.impulses)

        if (db_macro_states.macro_states.length > 0) {
            console.log ("fetched", db_macro_states.macro_states.length, "macro_states in total.")
            const macro_state = db_macro_states.macro_states[0]
            const dynamics = macro_state.dynamics
            const phi = macro_state.phi

            setUniverseAge (db_macro_states.macro_states.length - 1) // at age 0 a macro state event is emitted

            //
            // Phi: decode base64 to bytes, then bytes to BigNumber
            //
            // const phi = new BigNumber(Buffer.from(macro_state.phi, 'base64').toString('hex'), 16)
            // const phi_degree = (phi / 10**20) / (Math.PI * 2) * 360
            const phi_degree = parse_phi_to_degree (phi)

            console.log ("dynamics:", macro_state.dynamics)
            console.log ("phi_degree", phi_degree.toString())

            drawSpace (canvi, dynamics, phi_degree)
            _hasDrawnRef.current = true
        }
        else {
            console.log ('idle universe')
            drawIdleMessage (canvi)
        }
    }

    const drawIdleMessage = canvi => {
        const tbox_idle_message = new fabric.Text(
            'This universe is not active.', {
            fontSize: 16,
            left: 620, top: 350,
            fill: '#555555',
            fontFamily: 'Poppins-Light'
        });

        canvi.add (tbox_idle_message)
    }

    const drawSpace = (canvi, dynamics, phi_degree) => {
        const window_dim = windowDimensions
        // const macro_state = macro_states.macro_states[0]
        // const dynamics = macro_state.dynamics

        console.log ("window_dim", window_dim)

        // Set canvas dimensions on every draw
        canvi.setWidth(window_dim.width)
        canvi.setHeight(window_dim.height)

        const ORIGIN_X = window_dim.width / 2
        const ORIGIN_Y = window_dim.height / 2
        const DISPLAY_SCALE = 60
        const GRID_STYLE = {
            stroke: '#BBBBBB',
            strokeWidth: 0.5,
            selectable: false
        }
        const AXIS_STYLE = {
            stroke: '#666666',
            strokeWidth: 0.5,
            selectable: false
        }
        const TBOX_BG = '#DDDDDD55'
        const COCENTRIC_STROKE_COLOR = '#AAAAAA'
        const COCENTRIC_STROKE_WIDTH = 0.5

        //
        // Compute coordinates of celestial bodies
        //
        const plnt_x = dynamics.planet.q.x
        const plnt_y = dynamics.planet.q.y
        const sun0_x = dynamics.sun0.q.x
        const sun0_y = dynamics.sun0.q.y
        const sun1_x = dynamics.sun1.q.x
        const sun1_y = dynamics.sun1.q.y
        const sun2_x = dynamics.sun2.q.x
        const sun2_y = dynamics.sun2.q.y

        const sun0_left = ORIGIN_X + (sun0_x.toString(10)-SUN0_RADIUS) *DISPLAY_SCALE
        const sun0_top  = ORIGIN_Y + (sun0_y.toString(10)-SUN0_RADIUS) *DISPLAY_SCALE
        const sun0_left_center = ORIGIN_X + sun0_x.toString(10) *DISPLAY_SCALE
        const sun0_top_center  = ORIGIN_Y + sun0_y.toString(10) *DISPLAY_SCALE

        const sun1_left = ORIGIN_X + (sun1_x.toString(10)-SUN1_RADIUS) *DISPLAY_SCALE
        const sun1_top  = ORIGIN_Y + (sun1_y.toString(10)-SUN1_RADIUS) *DISPLAY_SCALE
        const sun1_left_center = ORIGIN_X + sun1_x.toString(10) *DISPLAY_SCALE
        const sun1_top_center  = ORIGIN_Y + sun1_y.toString(10) *DISPLAY_SCALE

        const sun2_left = ORIGIN_X + (sun2_x.toString(10)-SUN2_RADIUS) *DISPLAY_SCALE
        const sun2_top  = ORIGIN_Y + (sun2_y.toString(10)-SUN2_RADIUS) *DISPLAY_SCALE
        const sun2_left_center = ORIGIN_X + sun2_x.toString(10) *DISPLAY_SCALE
        const sun2_top_center  = ORIGIN_Y + sun2_y.toString(10) *DISPLAY_SCALE

        const plnt_left_center = ORIGIN_X + plnt_x.toString(10) *DISPLAY_SCALE
        const plnt_top_center  = ORIGIN_Y + plnt_y.toString(10) *DISPLAY_SCALE

        //
        // Draw grid lines first
        //
        const FONT_FAMILY = 'Poppins-Light'
        const TEXTBOX_WIDTH = 120
        const TEXTBOX_HEIGHT = 55
        const FONT_SIZE_NAME = 15
        const FONT_SIZE_COORD = 12
        const COORD_SLICE = 6
        const line0_vertical = new fabric.Line(
            [sun0_left_center, TEXTBOX_HEIGHT, sun0_left_center, sun0_top_center], GRID_STYLE);
        // const line0_horizontal = new fabric.Line(
        //     [0, sun0_top_center, sun0_left_center, sun0_top_center], GRID_STYLE);

        // const line1_vertical = new fabric.Line(
        //     [sun1_left_center, 0, sun1_left_center, sun1_top_center], GRID_STYLE);
        const line1_horizontal = new fabric.Line(
            [TEXTBOX_WIDTH, sun1_top_center, sun1_left_center, sun1_top_center], GRID_STYLE);

        // const line2_vertical = new fabric.Line(
        //     [sun2_left_center, 0, sun2_left_center, sun2_top_center], GRID_STYLE);
        const line2_horizontal = new fabric.Line(
            [sun2_left_center, sun2_top_center, window_dim.width-TEXTBOX_WIDTH, sun2_top_center], GRID_STYLE);

        const line_plnt_vertical = new fabric.Line(
            [plnt_left_center, plnt_top_center, plnt_left_center, window_dim.height-TEXTBOX_HEIGHT], GRID_STYLE);

        canvi.add (line0_vertical)
        // canvi.add (line0_horizontal)
        // canvi.add (line1_vertical)
        canvi.add (line1_horizontal)
        // canvi.add (line2_vertical)
        canvi.add (line2_horizontal)
        canvi.add (line_plnt_vertical)


        //
        // Draw textboxes
        //
        const sun0_coord_text = '(' + sun0_x.toString().slice(0,COORD_SLICE) + ', ' + sun0_y.toString().slice(0,COORD_SLICE) + ')'
        const sun1_coord_text = '(' + sun1_x.toString().slice(0,COORD_SLICE) + ', ' + sun1_y.toString().slice(0,COORD_SLICE) + ')'
        const sun2_coord_text = '(' + sun2_x.toString().slice(0,COORD_SLICE) + ', ' + sun2_y.toString().slice(0,COORD_SLICE) + ')'
        const plnt_coord_text = '(' + plnt_x.toString().slice(0,COORD_SLICE) + ', ' + plnt_y.toString().slice(0,COORD_SLICE) + ')'
        const RECT_BORDER_RADIUS = 10

        const tbox_plnt_bg = new fabric.Rect({
            fill: TBOX_BG,
            originX: 'center', originY: 'center',
            rx: RECT_BORDER_RADIUS, ry: RECT_BORDER_RADIUS,
            width:  TEXTBOX_WIDTH, height: TEXTBOX_HEIGHT
        });
        const tbox_plnt_text = new fabric.Text(
            'EV', {
            fontSize: FONT_SIZE_NAME, originX: 'center', originY: 'bottom', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_plnt_coord_text = new fabric.Text(
            plnt_coord_text, {
            fontSize: FONT_SIZE_COORD, originX: 'center', originY: 'top', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_plnt_group = new fabric.Group(
            [ tbox_plnt_bg, tbox_plnt_text, tbox_plnt_coord_text], {
            left: plnt_left_center - TEXTBOX_WIDTH/2,
            top: window_dim.height - TEXTBOX_HEIGHT
        });

        const tbox_sun0_bg = new fabric.Rect({
            fill: TBOX_BG,
            originX: 'center', originY: 'center',
            rx: RECT_BORDER_RADIUS, ry: RECT_BORDER_RADIUS,
            width: TEXTBOX_WIDTH, height: TEXTBOX_HEIGHT
        });
        const tbox_sun0_text = new fabric.Text(
            'ORTA', {
            fontSize: FONT_SIZE_NAME, originX: 'center', originY: 'bottom', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_sun0_coord_text = new fabric.Text(
            sun0_coord_text, {
            fontSize: FONT_SIZE_COORD, originX: 'center', originY: 'top', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_sun0_group = new fabric.Group(
            [ tbox_sun0_bg, tbox_sun0_text, tbox_sun0_coord_text ], {
            left: sun0_left_center - TEXTBOX_WIDTH/2,
            top: 0
        });

        const tbox_sun1_bg = new fabric.Rect({
            fill: TBOX_BG,
            originX: 'center', originY: 'center',
            rx: RECT_BORDER_RADIUS, ry: RECT_BORDER_RADIUS,
            width: TEXTBOX_WIDTH, height: TEXTBOX_HEIGHT
        });
        const tbox_sun1_text = new fabric.Text(
            'BÖYÜK', {
            fontSize: FONT_SIZE_NAME, originX: 'center', originY: 'bottom', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_sun1_coord_text = new fabric.Text(
            sun1_coord_text, {
            fontSize: FONT_SIZE_COORD, originX: 'center', originY: 'top', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_sun1_group = new fabric.Group(
            [ tbox_sun1_bg, tbox_sun1_text, tbox_sun1_coord_text ], {
            left: 0,
            top: sun1_top_center - TEXTBOX_HEIGHT/2
        });

        const tbox_sun2_bg = new fabric.Rect({
            fill: TBOX_BG,
            originX: 'center', originY: 'center',
            rx: RECT_BORDER_RADIUS, ry: RECT_BORDER_RADIUS,
            width: TEXTBOX_WIDTH, height: TEXTBOX_HEIGHT
        });
        const tbox_sun2_text = new fabric.Text(
            'BALACA', {
            fontSize: FONT_SIZE_NAME, originX: 'center', originY: 'bottom', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_sun2_coord_text = new fabric.Text(
            sun2_coord_text, {
            fontSize: FONT_SIZE_COORD, originX: 'center', originY: 'top', fill: '#333333', fontFamily: FONT_FAMILY
        });
        const tbox_sun2_group = new fabric.Group(
            [ tbox_sun2_bg, tbox_sun2_text, tbox_sun2_coord_text ], {
            left: window_dim.width-TEXTBOX_WIDTH,
            top: sun2_top_center - TEXTBOX_HEIGHT/2
        });

        canvi.add (tbox_plnt_group)
        canvi.add (tbox_sun0_group)
        canvi.add (tbox_sun1_group)
        canvi.add (tbox_sun2_group)


        //
        // Draw cocentric circles
        //
        const GRID_CIRCLE_RADIUS = 50
        for (let i = 0; i < 20; i++) {
            let radius = GRID_CIRCLE_RADIUS*i
            let circle = new fabric.Circle ({
                left: ORIGIN_X - radius,
                top:  ORIGIN_Y - radius,
                radius: radius,
                stroke: COCENTRIC_STROKE_COLOR,
                strokeWidth: COCENTRIC_STROKE_WIDTH,
                strokeDashArray: [5, 5],
                fill: '',
                selectable: false,
                hoverCursor: "default"
            });
            canvi.add (circle)
        }



        //
        // Draw the trajectories using historical states
        //
        if (db_macro_states.macro_states.length > 2){
            const history_len = db_macro_states.macro_states.length
            console.log("history_len", history_len)

            const drawn_len = history_len > 300 ? 300 : history_len
            for (var i = 1; i < drawn_len-1; i++){

                // use variable power of recency to taper opacity and width
                const ratio = (drawn_len-i) / drawn_len
                // console.log(`ratio: ${ratio}`)
                // const sun0_thickness = SUN0_RADIUS *DISPLAY_SCALE *2 * (ratio**1.2)
                // const sun1_thickness = SUN1_RADIUS *DISPLAY_SCALE *2 * (ratio**1.5)
                // const sun2_thickness = SUN2_RADIUS *DISPLAY_SCALE *2 * (ratio**1.5)
                // const plnt_thickness = PLNT_RADIUS *DISPLAY_SCALE *2 * (ratio**2)

                const sun0_thickness = SUN0_RADIUS *DISPLAY_SCALE *2 * (ratio**0.3)
                const sun1_thickness = SUN1_RADIUS *DISPLAY_SCALE *2 * (ratio**0.3)
                const sun2_thickness = SUN2_RADIUS *DISPLAY_SCALE *2 * (ratio**0.3)
                const plnt_thickness = PLNT_RADIUS *DISPLAY_SCALE *2 * (ratio**0.3)

                // const sun0_opacity = 0.03 + 0.5 * (ratio**5)
                // const sun1_opacity = 0.01 + 0.08 * (ratio**8)
                // const sun2_opacity = 0.05 * ratio
                // const plnt_opacity = 0.1 * (ratio**4)

                const sun0_opacity = 0.1 * (ratio**1.5)
                const sun1_opacity = 0.1 * (ratio**1.5)
                const sun2_opacity = 0.1 * (ratio**1.5)
                const plnt_opacity = 0.1 * (ratio**1.5)

                // grab two consecutive states
                const state_0 = db_macro_states.macro_states[i]
                const dynamics_0 = state_0.dynamics
                const state_1 = db_macro_states.macro_states[i+1]
                const dynamics_1 = state_1.dynamics

                // derive adjusted coordinates of celestial bodies
                const plnt_x0 = dynamics_0.planet.q.x
                const plnt_y0 = dynamics_0.planet.q.y
                const sun0_x0 = dynamics_0.sun0.q.x
                const sun0_y0 = dynamics_0.sun0.q.y
                const sun1_x0 = dynamics_0.sun1.q.x
                const sun1_y0 = dynamics_0.sun1.q.y
                const sun2_x0 = dynamics_0.sun2.q.x
                const sun2_y0 = dynamics_0.sun2.q.y

                const sun0_left0 = ORIGIN_X + (sun0_x0.toString(10)) *DISPLAY_SCALE -sun0_thickness/2
                const sun0_top0  = ORIGIN_Y + (sun0_y0.toString(10)) *DISPLAY_SCALE -sun0_thickness/2
                const sun1_left0 = ORIGIN_X + (sun1_x0.toString(10)) *DISPLAY_SCALE -sun1_thickness/2
                const sun1_top0  = ORIGIN_Y + (sun1_y0.toString(10)) *DISPLAY_SCALE -sun1_thickness/2
                const sun2_left0 = ORIGIN_X + (sun2_x0.toString(10)) *DISPLAY_SCALE -sun2_thickness/2
                const sun2_top0  = ORIGIN_Y + (sun2_y0.toString(10)) *DISPLAY_SCALE -sun2_thickness/2
                const plnt_left0 = ORIGIN_X + (plnt_x0.toString(10)) *DISPLAY_SCALE -plnt_thickness/2
                const plnt_top0  = ORIGIN_Y + (plnt_y0.toString(10)) *DISPLAY_SCALE -plnt_thickness/2

                const plnt_x1 = dynamics_1.planet.q.x
                const plnt_y1 = dynamics_1.planet.q.y
                const sun0_x1 = dynamics_1.sun0.q.x
                const sun0_y1 = dynamics_1.sun0.q.y
                const sun1_x1 = dynamics_1.sun1.q.x
                const sun1_y1 = dynamics_1.sun1.q.y
                const sun2_x1 = dynamics_1.sun2.q.x
                const sun2_y1 = dynamics_1.sun2.q.y

                const sun0_left1 = ORIGIN_X + (sun0_x1.toString(10)) *DISPLAY_SCALE -sun0_thickness/2
                const sun0_top1  = ORIGIN_Y + (sun0_y1.toString(10)) *DISPLAY_SCALE -sun0_thickness/2
                const sun1_left1 = ORIGIN_X + (sun1_x1.toString(10)) *DISPLAY_SCALE -sun1_thickness/2
                const sun1_top1  = ORIGIN_Y + (sun1_y1.toString(10)) *DISPLAY_SCALE -sun1_thickness/2
                const sun2_left1 = ORIGIN_X + (sun2_x1.toString(10)) *DISPLAY_SCALE -sun2_thickness/2
                const sun2_top1  = ORIGIN_Y + (sun2_y1.toString(10)) *DISPLAY_SCALE -sun2_thickness/2
                const plnt_left1 = ORIGIN_X + (plnt_x1.toString(10)) *DISPLAY_SCALE -plnt_thickness/2
                const plnt_top1  = ORIGIN_Y + (plnt_y1.toString(10)) *DISPLAY_SCALE -plnt_thickness/2

                // draw line segment connecting two states;
                // line thickness and opacity reflects recency
                canvi.add (new fabric.Line(
                    [sun0_left0, sun0_top0, sun0_left1, sun0_top1]
                    , { stroke: SUN0_TRAIL_FILL_LIGHT, strokeWidth: sun0_thickness, opacity: sun0_opacity,
                        strokeLineCap: 'round', selectable: false, hoverCursor: "default" }
                ));

                canvi.add (new fabric.Line(
                    [sun1_left0, sun1_top0, sun1_left1, sun1_top1]
                    , { stroke: SUN1_TRAIL_FILL_LIGHT, strokeWidth: sun1_thickness, opacity: sun1_opacity,
                        strokeLineCap: 'round', selectable: false, hoverCursor: "default" }
                ));

                canvi.add (new fabric.Line(
                    [sun2_left0, sun2_top0, sun2_left1, sun2_top1]
                    , { stroke: SUN2_TRAIL_FILL_LIGHT, strokeWidth: sun2_thickness, opacity: sun2_opacity,
                        strokeLineCap: 'round', selectable: false, hoverCursor: "default" }
                ));

                canvi.add (new fabric.Line(
                    [plnt_left0, plnt_top0, plnt_left1, plnt_top1]
                    , { stroke: EV_FILL_LIGHT, strokeWidth: plnt_thickness, opacity: plnt_opacity,
                        strokeLineCap: 'round', selectable: false, hoverCursor: "default" }
                ));

            }
        }

        //
        // Draw NDPE launch traces
        //
        if (db_impulses.impulses.length > 0){
            ndpeLaunchGroupsRef.current = []
            db_impulses.impulses.forEach((impulse) => {
                const plnt_q_x = impulse.most_recent_planet_q.x
                const plnt_q_y = impulse.most_recent_planet_q.y
                const delta_vx = impulse.impulse_applied.x / (1e-4)
                const delta_vy = impulse.impulse_applied.y / (1e-4)
                const delta_v_abs = Math.sqrt (delta_vx**2 + delta_vy**2)
                console.log ('delta_v_abs:', delta_v_abs)

                // const ndpe_launch_trace = new fabric.Line(
                //     [
                //         ORIGIN_X + plnt_q_x *DISPLAY_SCALE,
                //         ORIGIN_Y + plnt_q_y *DISPLAY_SCALE,
                //         ORIGIN_X + (plnt_q_x + delta_vx*5) *DISPLAY_SCALE,
                //         ORIGIN_Y + (plnt_q_y + delta_vy*5) *DISPLAY_SCALE
                //     ],{
                //         stroke: '#3333CC',
                //         strokeWidth: 0.8,
                //         strokeDashArray: [0.8, 1.65],
                //         strokeLineCap: "round",
                //         selectable: false
                //     }
                // );
                // canvi.add (ndpe_launch_trace)

                const N = 5
                const ndpeCircles = []
                for (var i=0; i<N; i++) {
                    // const radius = delta_v_abs * (i+1)
                    const radius = 0.05 * (i+1)
                    const stroke_color = '#3333CC'
                    const ndpe_launch_circle = new fabric.Circle ({
                        // left: radius * DISPLAY_SCALE,
                        // top:  radius * DISPLAY_SCALE,
                        radius: radius * DISPLAY_SCALE,
                        stroke: stroke_color,
                        opacity: (N-i)/N,
                        strokeWidth: 0.5,
                        fill: '#00000000',
                        selectable: false,
                        hoverCursor: "default",
                        originX: "center",
                        originY: "center",
                    });
                    ndpeCircles.push (ndpe_launch_circle)
                }
                const group = new fabric.Group (ndpeCircles, {
                    left: ORIGIN_X + (plnt_q_x - 0.25) * DISPLAY_SCALE,
                    top: ORIGIN_Y + (plnt_q_y - 0.25) * DISPLAY_SCALE,
                    hoverCursor: "pointer",
                })
                ndpeLaunchGroupsRef.current.push(group)
                canvi.add (group)
            })
        }


        //
        // Draw the celestial bodies as geometries
        //
        const SUN0_STROKE_WIDTH = 2
        const SUN1_STROKE_WIDTH = 3
        const SUN2_STROKE_WIDTH = 3
        const sun0_circle = new fabric.Circle ({
            left: sun0_left,
            top:  sun0_top,
            radius: SUN0_RADIUS * DISPLAY_SCALE,
            stroke: '#000000',
            strokeWidth: SUN0_STROKE_WIDTH,
            fill: SUN0_FILL_LIGHT,
            selectable: false,
            hoverCursor: "pointer"
        });

        const sun1_circle = new fabric.Circle ({
            left: ORIGIN_X + (sun1_x.toString(10)-SUN1_RADIUS) *DISPLAY_SCALE,
            top:  ORIGIN_Y + (sun1_y.toString(10)-SUN1_RADIUS) *DISPLAY_SCALE,
            radius: SUN1_RADIUS * DISPLAY_SCALE,
            stroke: '#000000',
            strokeWidth: SUN1_STROKE_WIDTH,
            fill: SUN1_FILL_LIGHT,
            selectable: false,
            hoverCursor: "pointer"
        });

        const sun2_circle = new fabric.Circle ({
            left: ORIGIN_X + (sun2_x.toString(10)-SUN2_RADIUS) *DISPLAY_SCALE,
            top:  ORIGIN_Y + (sun2_y.toString(10)-SUN2_RADIUS) *DISPLAY_SCALE,
            radius: SUN2_RADIUS * DISPLAY_SCALE,
            stroke: '#000000',
            strokeWidth: SUN2_STROKE_WIDTH,
            fill: SUN2_FILL_LIGHT,
            selectable: false,
            hoverCursor: "pointer"
        });

        const plnt_square = createPlnt (
            ORIGIN_X + (plnt_x.toString(10)-PLNT_RADIUS) *DISPLAY_SCALE,
            ORIGIN_Y + (plnt_y.toString(10)-PLNT_RADIUS) *DISPLAY_SCALE,
            PLNT_RADIUS * 2 * DISPLAY_SCALE,
            phi_degree,
            EV_FILL_LIGHT,
            '#000000',
            1.5,
            "pointer",
            1.0
        )

        plntRectRef.current = plnt_square

        canvi.add (sun0_circle)
        canvi.add (sun1_circle)
        canvi.add (sun2_circle)
        canvi.add (plnt_square)

        //
        // Draw the celestial bodies as images
        //
        const sun0_scale = 0.0798
        const sun0_img_offset_x = 0
        const sun0_img_offset_y = 0
        const sun0_img_left = ORIGIN_X + (sun0_x.toString(10)-SUN0_RADIUS-sun0_img_offset_x) *DISPLAY_SCALE +SUN0_STROKE_WIDTH/2
        const sun0_img_top  = ORIGIN_Y + (sun0_y.toString(10)-SUN0_RADIUS-sun0_img_offset_y) *DISPLAY_SCALE +SUN0_STROKE_WIDTH/2

        const sun1_scale = 0.2035
        const sun1_img_offset_x = 0
        const sun1_img_offset_y = 0
        const sun1_img_left = ORIGIN_X + (sun1_x.toString(10)-SUN1_RADIUS-sun1_img_offset_x) *DISPLAY_SCALE +SUN1_STROKE_WIDTH/2
        const sun1_img_top  = ORIGIN_Y + (sun1_y.toString(10)-SUN1_RADIUS-sun1_img_offset_y) *DISPLAY_SCALE +SUN1_STROKE_WIDTH/2

        const sun2_scale = 0.1255
        const sun2_img_offset_x = 0
        const sun2_img_offset_y = 0
        const sun2_img_left = ORIGIN_X + (sun2_x.toString(10)-SUN2_RADIUS-sun2_img_offset_x) *DISPLAY_SCALE +SUN2_STROKE_WIDTH/2
        const sun2_img_top  = ORIGIN_Y + (sun2_y.toString(10)-SUN2_RADIUS-sun2_img_offset_y) *DISPLAY_SCALE +SUN2_STROKE_WIDTH/2

        const sun0_img_element = document.getElementById('sun0-img');
        const sun0_img_instance = new fabric.Image(sun0_img_element, {
            left: sun0_img_left,
            top: sun0_img_top,
            scaleX: sun0_scale,
            scaleY: sun0_scale,
            opacity: 1,
            selectable: false,
            hoverCursor: "pointer"
        });

        sun0ImgRef.current = sun0_img_instance

        const sun1_img_element = document.getElementById('sun1-img');
        const sun1_img_instance = new fabric.Image(sun1_img_element, {
            left: sun1_img_left,
            top: sun1_img_top,
            scaleX: sun1_scale,
            scaleY: sun1_scale,
            opacity: 1,
            selectable: false,
            hoverCursor: "pointer"
        });

        sun1ImgRef.current = sun1_img_instance

        const sun2_img_element = document.getElementById('sun2-img');
        const sun2_img_instance = new fabric.Image(sun2_img_element, {
            left: sun2_img_left,
            top: sun2_img_top,
            scaleX: sun2_scale,
            scaleY: sun2_scale,
            opacity: 1,
            selectable: false,
            hoverCursor: "pointer"
        });

        sun2ImgRef.current = sun2_img_instance

        canvi.add(sun0_img_instance);
        canvi.add(sun1_img_instance);
        canvi.add(sun2_img_instance);

        //
        // Draw planet orientation helper
        //
        console.log (`planet rotation in degree: ${phi_degree}`)
        const NORMAL_LINE_LEN = 15
        const faces = [0,2,4,5]
        var orientation_helper_objs = []

        faces.forEach (function(face, i){
            const RAD = PLNT_RADIUS / 4
            const plnt_face_vec = new fabric.Line(
                [
                    ORIGIN_X + (plnt_x + RAD) *DISPLAY_SCALE,
                    ORIGIN_Y + (plnt_y + RAD) *DISPLAY_SCALE,
                    ORIGIN_X + (plnt_x + RAD) *DISPLAY_SCALE + NORMAL_LINE_LEN,
                    ORIGIN_Y + (plnt_y + RAD) *DISPLAY_SCALE
                ],{
                    stroke: '#888888', strokeWidth: 1,
                    angle: phi_degree + i*90,
                    selectable: false, hoverCursor: "default",
                    visible: false
                }
            );

            const tbox_face_bg = new fabric.Circle({
                fill: TBOX_BG, originX: 'center', originY: 'center',
                radius: NORMAL_LINE_LEN*0.75, selectable: false, hoverCursor: "default"
            });
            const tbox_face_text = new fabric.Text(
                face.toString(10), {
                fontSize: 10, originX: 'center', originY: 'center', fill: '#333333', fontFamily: FONT_FAMILY,
                selectable: false, hoverCursor: "default"
            });
            const vec_face = rotateVector ([NORMAL_LINE_LEN+10, 0], -(phi_degree + i*90)) // this rotation takes up as +Y, which is opposite of fabric canvas Y direction
            const tbox_face_group = new fabric.Group(
                [ tbox_face_bg, tbox_face_text ], {
                left: ORIGIN_X + plnt_x.toString(10) *DISPLAY_SCALE + vec_face[0],
                top:  ORIGIN_Y + plnt_y.toString(10) *DISPLAY_SCALE + vec_face[1],
                originX: 'center', originY: 'center',
                selectable: false, hoverCursor: "default",
                visible: false
            });

            canvi.add (plnt_face_vec)
            canvi.add (tbox_face_group)

            orientation_helper_objs.push (plnt_face_vec)
            orientation_helper_objs.push (tbox_face_group)
        })
        faceAssistObjsRef.current = orientation_helper_objs

        //
        // Draw axis directionalities
        //
        const AXIS_LEN = 50
        const AXIS_TRI_W = 6
        const AXIS_TRI_H = 8
        const AXIS_ORI_X = 50
        const AXIS_ORI_Y = 50
        const axis_line_x = new fabric.Line(
            [AXIS_ORI_X, AXIS_ORI_Y, AXIS_ORI_X+AXIS_LEN, AXIS_ORI_Y], AXIS_STYLE);
        const axis_line_y = new fabric.Line(
            [AXIS_ORI_X, AXIS_ORI_Y, AXIS_ORI_X, AXIS_ORI_Y+AXIS_LEN], AXIS_STYLE);
        const axis_tri_x = createTriangle (
            AXIS_ORI_X+AXIS_LEN, AXIS_ORI_Y-AXIS_TRI_W,
            AXIS_TRI_W, AXIS_TRI_H,
            90,
            AXIS_STYLE
        )
        const axis_tri_y = createTriangle (
            AXIS_ORI_X-AXIS_TRI_W/2+1, AXIS_ORI_Y+AXIS_LEN-2,
            AXIS_TRI_W, AXIS_TRI_H,
            180,
            AXIS_STYLE
        )
        const tbox_axis_x = new fabric.Text(
            'x', {
            left: AXIS_ORI_X + AXIS_LEN + AXIS_TRI_H + 5,
            top: AXIS_ORI_Y - 10,
            fontSize: 16,
            fill: '#333333',
            fontFamily: FONT_FAMILY,
            selectable: 'false', hoverCursor: "default"
        });
        const tbox_axis_y = new fabric.Text(
            'y', {
            left: AXIS_ORI_X - 5,
            top: AXIS_ORI_Y + AXIS_LEN + AXIS_TRI_H,
            fontSize: 16,
            fill: '#333333',
            fontFamily: FONT_FAMILY,
            selectable: 'false', hoverCursor: "default"
        });

        canvi.add (axis_line_x)
        canvi.add (axis_line_y)
        canvi.add (axis_tri_x)
        canvi.add (axis_tri_y)
        canvi.add (tbox_axis_x)
        canvi.add (tbox_axis_y)
    }

    const info_style = {
        position:'fixed',
        borderRadius: '10px 0 0 0',
        right:'0',
        bottom:'0',
        width:'22em',
        paddingLeft:'1em',
        paddingRight:'1em',
        paddingTop: '1em',
        paddingBottom: '1em',
        height:'8em',
        lineHeight:'3em',
        color: '#555555',
        backgroundColor:'#DDDDDD55',
        fontFamily: 'Poppins-Light',
        fontSize: '0.85em',
        zIndex:'3',
        textAlign:'center',
        verticalAlign:'middle'
    }

    function handleMouseMove(ev) {

        var pointer = _canvasRef.current.getPointer(ev);
        var x = pointer.x;
        var y = pointer.y;
        // console.log (`> mouse move: (${x},${y})`)

        // Set the tooltip position to follow mouse cursor
        if (tooltipRef.current) {
            const height = tooltipRef.current.clientHeight
            const width = tooltipRef.current.clientWidth
            tooltipRef.current.style.left = `${ev.clientX - width / 2}px`
            tooltipRef.current.style.top = `${ev.clientY - 10 - height}px`
        }

    }

    function velocity_change_to_arrow_sign (val, is_x=true) {
        const sign = Math.sign (val)

        if (is_x) {
            if (sign == 1) return '→'
            else if (sign == -1) return '←'
            else return ''
        }
        else {
            if (sign == 1) return '↓'
            else if (sign == -1) return '↑'
            else return ''
        }
    }

    function boolean_to_next_show_hide (bool) {
        if (bool) return 'hide'
        else return 'show'
    }
    const kbd_style = {
        border: '1px solid currentColor',
        padding: '0px 4px'
    }
    //
    // Return component
    //
    return(
        <div
            onMouseMove = { (ev) => handleMouseMove(ev) }
        >
            <div style={{fontFamily:'Poppins-Light',height:'0',fontColor:'#00000000'}}>{timeLeft}s</div>
            <canvas id="c" />
            <img src='/sun0_crop.png' id="sun0-img" style={{visibility:imgVisibility}} />
            <img src="/sun1_crop.png" id="sun1-img" style={{visibility:imgVisibility}} />
            <img src="/sun2_crop.png" id="sun2-img" style={{visibility:imgVisibility}} />
            <div style={info_style}>
                Age of universe: {universeAge} / 2520 ticks
                <br />
                <span style={{fontSize:'12px'}}>Press <span style={kbd_style}>q</span> to {boolean_to_next_show_hide(showFaceAssist)} planet face indicators</span>
            </div>
            {tooltip && (
                <div ref={tooltipRef} className={styles.tooltip} style={{borderRadius:'10px 10px 10px 10px'}}>
                    {tooltip.startsWith('ndpeImpulse') && hoveredImpulseDelta && planetVRelChange ? (
                        <>
                            <div className={styles.tooltipTitle}>
                                Engine Launch #{hoveredImpulseIndex + 1}
                            </div>
                            <div className={styles.tooltipInfo}>
                                |ΔV<sub>x</sub>| = {hoveredImpulseDelta.x == 0 ? '' : velocity_change_to_arrow_sign(hoveredImpulseDelta.x, true)} {planetVRelChange.x_from_0 ? Math.abs(planetVRelChange.x).toExponential(2).toString(10) + '/tick' : (Math.abs(planetVRelChange.x) * 100).toFixed(3).toString(10) + '%'}
                                <br />
                                |ΔV<sub>y</sub>| = {hoveredImpulseDelta.y == 0 ? '' : velocity_change_to_arrow_sign(hoveredImpulseDelta.y, false)} {planetVRelChange.y_from_0 ? Math.abs(planetVRelChange.y).toExponential(2).toString(10) + '/tick' : (Math.abs(planetVRelChange.y) * 100).toFixed(3).toString(10) + '%'}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className={styles.tooltipTitle}>
                                {tooltip}
                            </div>
                            <div className={styles.tooltipInfo}>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// source: https://stackoverflow.com/a/28112459
var rotateVector = function (vec, ang)
{
    ang = -ang * (Math.PI/180);
    var cos = Math.cos(ang);
    var sin = Math.sin(ang);
    return new Array(Math.round(10000*(vec[0] * cos - vec[1] * sin))/10000, Math.round(10000*(vec[0] * sin + vec[1] * cos))/10000);
};

function fp_felt_to_num(felt) {
    BigNumber.config({ EXPONENTIAL_AT: 76 })

    const felt_bn = new BigNumber(felt) // for weird reasons, the input `felt` may not be BigNumber, so this casting is required
    const felt_minus_half_prime = felt_bn.minus(STARK_PRIME_HALF)

    const felt_signed = felt_minus_half_prime.isPositive() ? felt_bn.minus(STARK_PRIME) : felt_bn;
    const felt_descaled = felt_signed.dividedBy(10 ** 20)

    return felt_descaled
  }


function fp_felt_to_string(felt) {

    const felt_descaled = fp_felt_to_num (felt)

    return felt_descaled.toString(10)
}


// function useWindowDimensions() {
//     const [windowDimensions, setWindowDimensions] = useState(getWindowDimensions());

//     useEffect(() => {
//         function handleResize() {
//             setWindowDimensions (getWindowDimensions());
//         }

//         window.addEventListener('resize', handleResize);
//         return () => window.removeEventListener('resize', handleResize);
//     }, []);

//     return windowDimensions;
// }

function getWindowDimensions() {
    if (typeof window !== 'undefined') {
        const { innerWidth: width, innerHeight: height } = window;
        // console.log("window is defined!")
        return { width, height };
    } else {
        // console.log('You are on the server')
        return { width : 700, height : 815 }
    }
}
