//import { VZomePostProcessorCSS } from "./vzome-post-processor.css.js";

export class VZomePostProcessor extends HTMLElement {
	#downloadLink;
	static sigfig = 1000000000; // significant digits for rounding
	static fixedBackgroundColor = "#AFC8DC"; // desktop default background color
	static style = "background-color:" + VZomePostProcessor.fixedBackgroundColor + ";"
		+ "color:black;"
		//+ "font-style:italic;"
		+ "padding:4px;";
	static errorStyle = "background-color:yellow; color:black; font-style:italic; padding: 4px;";
	static shapeColors = new Map();
	static {
		// TODO: Any changes to these colors should be updated in READM.html as well
		VZomePostProcessor.shapeColors.set( 3, "#F0A000"); // yellow strut
		VZomePostProcessor.shapeColors.set( 4, "#007695"); // blue strut
		VZomePostProcessor.shapeColors.set( 5, "#AF0000"); // red strut
		VZomePostProcessor.shapeColors.set( 6, "#008D36"); // green strut
		VZomePostProcessor.shapeColors.set( 8, "#DC4C00"); // orange strut
		VZomePostProcessor.shapeColors.set(10, "#6C00C6"); // purple strut
	}

	constructor() {
		super();
		const root = this.attachShadow({ mode: "open" });
		//root.appendChild( document.createElement("style") ).textContent = VZomePostProcessorCSS;
		const container = document.createElement("div");
		//container.className = "post-processor";
		root.appendChild(container);
		this.#downloadLink = document.createElement("a");
		this.#downloadLink.setAttribute("rel", "noopener");
		this.#downloadLink.setAttribute("target", "_blank");
		container.appendChild(this.#downloadLink);
	}

	//connectedCallback() {
        // replace any existing content with the new content
        //this.#container.innerHTML = "";
        //this.#container.appendChild(table);
	//}

	// https://medium.com/charisol-community/downloading-resources-in-html5-a-download-may-not-work-as-expected-bf63546e2baa
	// This method works with local files as well as cross origin files.
	downloadShapesJson(src) {
		const url = src.replace( ".vZome", ".shapes.json" );
		const filename = url.substring(url.lastIndexOf( "/" ) + 1);
		console.log("%c%s", VZomePostProcessor.style,  `downloading ${url}` );		
		fetch(url)
		.then(response => {
			if(!response.ok) {
				console.log("%c%s", VZomePostProcessor.errorStyle, response);
				throw new Error(`${response.url}\n\n${response.status} ${response.statusText}`) 
			} 
			this.#downloadLink.download = filename;
			return response.json(); 
		} )
		.then(modelData => {
			const stringifiedData = JSON.stringify(this.postProcess(modelData), null, 2);
			const blobUrl = URL.createObjectURL(new Blob([stringifiedData], { type: "application/json" }));
			this.#downloadLink.href = blobUrl;
			this.#downloadLink.click();
			URL.revokeObjectURL(blobUrl); // release blobURL resources now that we're done with it.
			this.#downloadLink.href = ""; // remove the reference to the released blobURL.
			this.#downloadLink.download = ""; // 
		})
		.catch(error => {
			console.log("%c%s", VZomePostProcessor.errorStyle, error);
			alert(error);
		});
	}

	postProcess(modelData) {
		console.log("%c%s", VZomePostProcessor.style, 
			`Model format = ${modelData.format ?? "desktop"}\nModel polygons = ${modelData.polygons}`);
		// desktop has no 'polygons' property for multi-triangle formatted panels
		// desktop saves  'polygons' as a string: "true" for polygon formatted panels
		// online  saves  'polygons' as a boolean: true
		// this should handle any of these cases
		// although some of the subsequent scene processing will fail since online json format is very different, 
		// so bail out here for anything except desktop polygon format 
		// even though some of the code to handle online is here and all of it except standardizeCameras() is working.
		if((`${modelData.polygons}`) != "true") {
			alert("Model data is not in polygon JSON format.\n" +
				"Post processing will be skipped.\n\n" +
				`JSON format = ${modelData.format}\npolygons = ${modelData.polygons}`);
		} else {
			const shapeMap = this.getShapeMap(modelData);
			const snapshots = this.getSnapshots(modelData);
			this.recolor(modelData, shapeMap, snapshots);
			this.rescale(modelData, shapeMap, snapshots);
			this.standardizeCameras(modelData, shapeMap, snapshots);
		}
		return modelData;
	}

	standardizeCameras(modelData, shapeMap, snapshots) {
		// Adjust all camera vector settings to the same values
		// and zoom levels so that any model that's the first one loaded will be zoomed to fit
		// and others will use the same initial zoom level.
		// Any model could be the one that sets the default camera if the "A=" queryparam is used.
		// Some of these camera settings don't quite scale consistently 
		// if the models are a mix of desktop and online, but they work OK for now 
		// using either one as long as they're all from the same source.
		// TODO: Get the scaling to be the same for either format.
		const distance = this.getDistanceScaledToFitView(modelData, shapeMap, snapshots);
		this.standardizeCamera(modelData.camera, distance);
		for(let scene of modelData.scenes) {
			this.standardizeCamera(scene.camera ?? scene.view, distance); // online vs desktop
		}
		return modelData;
	}
	
	cameraFieldOfViewY(width, distance) {
	  const halfX = width / 2;
	  const halfY = halfX; // assumes aspectWtoH = 1.0;
	  return 360 * Math.atan( halfY / distance ) / Math.PI;
	}
	
	getDistanceScaledToFitView(modelData, shapeMap, snapshots) {
		const origin = {x:0, y:0, z:0};
		var maxRadius = 0;
		for(const snapshot of snapshots) {
			const ss = modelData.snapshots[snapshot];
			for(let i = 0; i < ss.length; i++) {
				const instance = ss[i];
				const shapeGuid = this.getShapeGuid(instance);
				const vertices = shapeMap.get(shapeGuid).vertices;
				for(const vertex of vertices) {
					maxRadius = Math.max( maxRadius, this.edgeLength(origin, vertex) );
				}
			}
		}
		// Originally, I planned to determine the distance based on the view frustum 
		// and a sphere with radius = maxRadius, but I determined that a simple scaling
		// of maxRadius is adequate and much simpler.
		// Emperically, distance ends up being 
		// about 12 for J1 which is the smallest solid
		//   and 48 for J71 which is the biggest solid.
		// For the Archimedean Solids, 
		// A1 (Truncated tetrahedron) is the smallest 
		// and A11 (Truncated icosadodecahedron) is the largest
		maxRadius *= 8; // Scale factor of 8 was determined empirically as a reasonable best-fit.
		console.log("%c%s", VZomePostProcessor.style,
			`maxRadius = ${maxRadius}`);
		return maxRadius;
	}
	
	standardizeCamera(camera, distance) {
		// Much of this is copied from online/src/viewer/context/camera.jsx
		const NEAR_FACTOR = 0.1;
		const FAR_FACTOR = 2.0;
		const WIDTH_FACTOR = 0.45; // originally 0.5 
		camera.perspective = true;
		// online and desktop json formats use different property names for the camera
		if(camera.near) {
			// online json format
			camera.distance = distance;
			camera.far = distance * FAR_FACTOR;
			camera.near = distance * NEAR_FACTOR;
			camera.width = distance * WIDTH_FACTOR;
			camera.lookAt = [0,0,0];
			camera.up = [0,1,0];
			camera.lookDir = [0,0,-1];
			//camera.fieldOfView and camera.position 
			// are not persisted in the online json format,
			// but rather, they are calculated from lookAt, lookDir, distance, etc... 
		} else {
			// desktop json format
			camera.stereo = false;

			camera.viewDistance = distance;
			camera.farClipDistance = distance * FAR_FACTOR;
			camera.nearClipDistance = distance * NEAR_FACTOR;
			camera.width = distance * WIDTH_FACTOR;
			camera.fieldOfView = this.cameraFieldOfViewY(camera.width, camera.viewDistance);
				
			camera.position.x = 0;
			camera.position.y = 0;
			camera.position.z = camera.viewDistance;
		
			camera.lookAtPoint.x = 0;
			camera.lookAtPoint.y = 0;
			camera.lookAtPoint.z = 0;
		
			camera.upDirection.x = 0;
			camera.upDirection.y = 1;
			camera.upDirection.z = 0;
			
			camera.lookDirection.x = 0;
			camera.lookDirection.y = 0;
			camera.lookDirection.z = -1;
			
			// I'm not sure that we need to set all of the RV (RealVector) equivalents, 
			// but just so everything is consistent...
			camera.lookAtPointRV.x = 0.0;
			camera.lookAtPointRV.y = 0.0;
			camera.lookAtPointRV.z = 0.0;
			camera.lookAtPointRV.zero = true;
		
			camera.upDirectionRV.x = 0.0;
			camera.upDirectionRV.y = 1.0;
			camera.upDirectionRV.z = 0.0;
			camera.upDirectionRV.zero = false;
			
			camera.lookDirectionRV.x = 0.0;
			camera.lookDirectionRV.y = 0.0;
			camera.lookDirectionRV.z = -1.0;
			camera.lookDirectionRV.zero = false;
		}
		// console.dir(camera);
		// No need to return the camera because it's passed by reference and updated in situ
	}
	
	rescale(modelData, shapeMap, snapshots) {
		var minLength = Number.MAX_VALUE;
		for(const snapshot of snapshots) {
			const ss = modelData.snapshots[snapshot];
			if(!ss || ss.length == 0) {
				console.log("%c%s", VZomePostProcessor.style,
					`Snapshot named ${snapshot} was not found.`);
					continue;
			}
			for(let i = 0; i < ss.length; i++) {
				const instance = ss[i];
				const shapeGuid = this.getShapeGuid(instance);
				const shape = shapeMap.get(shapeGuid);
				if(this.isPanel(shape)) {
					const vertices = shape.vertices;
					minLength = Math.min(minLength, this.edgeLength(vertices[0], vertices[vertices.length-1]));
					for(let v = 1; v < vertices.length; v++) {
						minLength = Math.min( minLength, this.edgeLength(vertices[v-1], vertices[v]) );
					}			
				}
			}
		}
		// Many models have minLength of 8.472135952064994 = (2+4phi) corresponding to blue zometool lengths.
		// The target edge length will be 2.0 because most of the coordinates on qfbox and wikipedia
		// have edge length of 2, resulting in a half edge length of 1 on each side of the symmetry plane(s).
		const sigfig = VZomePostProcessor.sigfig;
		const scaleFactor = Math.round((2.0 / minLength) * sigfig) / sigfig;
		console.log("%c%s", VZomePostProcessor.style,
			`calculated scaleFactor = ${scaleFactor}`);
		if(!!modelData.scaleFactor) {
			console.log("%c%s", VZomePostProcessor.errorStyle,
				`Previously calculated scaleFactor of ${modelData.scaleFactor} will NOT be modified.`);
		} else {
			// persist scaleFactor in the json
			modelData.scaleFactor = scaleFactor;
			const sigScaleFactor = scaleFactor * sigfig; // scaleVector() will divide by sigfig after rounding
			// scale all shape vertices
			for(let s = 0; s < modelData.shapes.length; s++) {
				for(let v = 0; v < modelData.shapes[s].vertices.length; v++) {
					this.scaleVector(sigScaleFactor, modelData.shapes[s].vertices[v]);
				}
			}
			// scale all instance positions
			for(let i = 0; i < modelData.instances.length; i++) {
				this.scaleVector(sigScaleFactor, modelData.instances[i].position);
			}
			// scale all snapshot positions
			for(let i = 0; i < modelData.snapshots.length; i++) {
				for(let j = 0; j < modelData.snapshots[i].length; j++) {
					this.scaleVector(sigScaleFactor, modelData.snapshots[i][j].position);
				}
			}
		}
		return modelData;
	}
	
	edgeLength(v0, v1) {
		const x = v0.x - v1.x;
		const y = v0.y - v1.y;
		const z = v0.z - v1.z;
		return Math.sqrt((x*x)+(y*y)+(z*z));
	}
	
	recolor(modelData, shapeMap, snapshots) {
		const lighting = modelData.lighting ?? modelData.lights; // online vs desktop
		lighting.backgroundColor = VZomePostProcessor.fixedBackgroundColor;
		for(const snapshot of snapshots) {
			const ss = modelData.snapshots[snapshot];
			if(!ss || ss.length == 0) {
				console.log("%c%s", VZomePostProcessor.errorStyle,
					`Snapshot named ${snapshot} was not found.`);
					continue;
			}
			for(let i = 0; i < ss.length; i++) {
				const instance = ss[i];
				const shapeGuid = this.getShapeGuid(instance);
				const shape = shapeMap.get(shapeGuid);
				if(this.isPanel(shape)) {
					const nVertices = shape.vertices.length;
					const newColor = VZomePostProcessor.shapeColors.get(nVertices);
					if(newColor) {		
						modelData.snapshots[snapshot][i].color = newColor;
					} else {
						console.log("%c%s", VZomePostProcessor.errorStyle,
							`\tshape ${shapeGuid} skipped - no color found for ${nVertices} vertices`);
					}
				}
			}
		}
		return modelData;
	}
	
	getShapeGuid(instance) {
		return instance.shapeId ?? instance.shape; // online vs desktop
	}

	scaleVector(scalar, vector) {
		const sigfig = VZomePostProcessor.sigfig;
		vector.x = Math.round( vector.x * scalar ) / sigfig;
		vector.y = Math.round( vector.y * scalar ) / sigfig;
		vector.z = Math.round( vector.z * scalar ) / sigfig;
		// don't need to return the vector because it's passed by reference and updated in situ
	}
	
	getSnapshots(modelData) {
		const snapshots = [];
		if(modelData.format != "online") {
			snapshots.push(0); // default scene is 0 for desktop, -1 for online
		}
		for(const scene of modelData.scenes) {
			// default scene is the number -1 (not a string) for onine
			// all others are integers as strings for online
			snapshots.push((scene.snapshot == -1) ? "0" : scene.snapshot);
		}
		return snapshots;
	}

	getShapeMap(modelData) {
		// modelData.shapes is an array when the json generated in desktop.
		// modelData.shapes is a collection of properties with guids for names if generated online.
		// Although this is not the normal way to access an array,
		// it is used here because it works in either case.
		// Note that in one case, id is the array index
		// and in the other case, it is the guid property name.
		// Therefore, we don't use the id. It's just a placeholder.
		const shapeMap = new Map();
		for (const [id, shape] of Object.entries(modelData.shapes)) {
			shapeMap.set(shape.id, shape);
		}
		return shapeMap;
	}

	isBall(shape) {
		return shape.name == 'ball';
	}
	
	isStrut(shape) {
		return shape.orbit != undefined;
	}
	
	isPanel(shape) {
		return shape.faces && shape.faces.length == 2;
	}

	attributeChangedCallback( attributeName, oldValue, newValue ) {
		switch(attributeName) {
			case "download":
				this.downloadShapesJson(newValue);
				break;
			default:
				console.log("%c%s", VZomePostProcessor.errorStyle,
					`UNHANDLED ATTRIBUTE CHANGE\n${attributeName} = ${newValue}`);
				break;
		}
	}

	get download() {
		return this.getAttribute("download");
	}
	set download(newValue) {
		this.setAttribute("download", newValue);
	}

	static get observedAttributes() {
		return [ "download" ];
	}
}

customElements.define( "vzome-post-processor", VZomePostProcessor );