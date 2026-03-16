const canvas = document.getElementById("exposureCanvas");
const ctx = canvas.getContext("2d");
const width = canvas.width;
const height = canvas.height;

const x0 = width / 2;
const y0 = height / 2;

const c = 3e8;
const h = 6.626e-34;
const kB = 1.380649e-23; 

// Slider parameters
let seeing = 3;
let airmass = 1;
let expTime = 3;
let ABmag = 5;
let telDiameter = 4;
let altitude = 1000;
let saturation = 70000;
let slitSize = 5;
let useCosmicRays = false;
let useSlit = false;
let usePrism = false;
let useClipping = false;
let showColors = false;
let showHydrogenLamp = false;
let showHeliumLamp = false;
let timerId = null;

// Star parameters
let T_eff = 5000;
let R_star = 6.96e8;
let d_star = 1.5e12;

// Flux storage
let nonPrismFlux = 0;
let prismFluxColumns = new Array(width).fill(0);
let psf2D;
let psfHalfSize;

// Enables smart lamp checkbox behavior
const updateLampCheckboxes = () => {
  const enableLamps = (document.getElementById("useSlit").checked && document.getElementById("usePrism").checked);

    // Enable/disable lamp checkboxes
    document.getElementById("showHydrogenLamp").disabled = !enableLamps;
    document.getElementById("showHeliumLamp").disabled = !enableLamps;

    // Uncheck lamps if they are disabled
    if (!enableLamps) {
        showHeliumLamp = false;
        showHydrogenLamp = false;
        document.getElementById("showHeliumLamp").checked = false;
        document.getElementById("showHydrogenLamp").checked = false;
    }
}

// Simulates lamp emissions at a given wavelength
const simulateLampEmissions = (element, lambda) => {
  const lineList = {
    hydrogen: [410, 434, 486, 656],
    helium:   [388, 447, 492, 501, 587, 667]
  };

  const halfWidth = slitSize / 2;
  const edgeSigma = slitSize * 0.2; // feather strength

  let contrib = [0, 0, 0]; // accumulate RGB

  for (let idx = 0; idx < lineList[element].length; idx++) {
    const lam0 = lineList[element][idx];
    const dlam = Math.abs(lambda - lam0);

    if (dlam < halfWidth + 3 * edgeSigma) {
      let weight;
      if (dlam <= halfWidth) {
        weight = 1.0;
      } else {
        const dx = dlam - halfWidth;
        weight = Math.exp(-0.5 * (dx / edgeSigma) ** 2);
      }

      let r, g, b;
      if (showColors) {
        [r, g, b] = rgbFromWavelength(lam0);
      } else {
        r = g = b = 255;
      }

      contrib[0] += r * weight;
      contrib[1] += g * weight;
      contrib[2] += b * weight;
    }
  }

  return contrib;
};

// Generates random number from normal distribution
const normalRandom = (mean=0, stdev=1) => {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
}

// Approximates RGB color from wavelength in nm
const rgbFromWavelength = (wavelength) => {
        var Gamma = 0.80,
        IntensityMax = 255,
        factor, red, green, blue;
        if((wavelength >= 380) && (wavelength<440)){
            red = -(wavelength - 440) / (440 - 380);
            green = 0.0;
            blue = 1.0;
        }else if((wavelength >= 440) && (wavelength<490)){
            red = 0.0;
            green = (wavelength - 440) / (490 - 440);
            blue = 1.0;
        }else if((wavelength >= 490) && (wavelength<510)){
            red = 0.0;
            green = 1.0;
            blue = -(wavelength - 510) / (510 - 490);
        }else if((wavelength >= 510) && (wavelength<580)){
            red = (wavelength - 510) / (580 - 510);
            green = 1.0;
            blue = 0.0;
        }else if((wavelength >= 580) && (wavelength<645)){
            red = 1.0;
            green = -(wavelength - 645) / (645 - 580);
            blue = 0.0;
        }else if((wavelength >= 645) && (wavelength<781)){
            red = 1.0;
            green = 0.0;
            blue = 0.0;
        }else{
            red = 0.0;
            green = 0.0;
            blue = 0.0;
        };
        // Let the intensity fall off near the vision limits
        if((wavelength >= 380) && (wavelength<420)){
            factor = 0.3 + 0.7*(wavelength - 380) / (420 - 380);
        }else if((wavelength >= 420) && (wavelength<701)){
            factor = 1.0;
        }else if((wavelength >= 701) && (wavelength<781)){
            factor = 0.3 + 0.7*(780 - wavelength) / (780 - 700);
        }else{
            factor = 0.0;
        };
        if (red !== 0){
            red = Math.round(IntensityMax * Math.pow(red * factor, Gamma));
        }
        if (green !== 0){
            green = Math.round(IntensityMax * Math.pow(green * factor, Gamma));
        }
        if (blue !== 0){
            blue = Math.round(IntensityMax * Math.pow(blue * factor, Gamma));
        }
        return [red,green,blue];
}

// Planck function to get photon flux at Earth
const planckPhotonFlux = (lambda, T) => {
    const B_lambda = (2 * h * c**2) / (lambda**5) /
        (Math.exp(h*c/(lambda*kB*T)) - 1);
    const fluxAtEarth = B_lambda * Math.PI * (R_star/d_star)**2;
    const Ephoton = h * c / lambda;
    return fluxAtEarth / Ephoton;
}

// Total photon flux for non-prism case
const totalPhotonFluxNonPrism = (T) => {
    const lambda_min = 300e-9, lambda_max = 900e-9;
    const nSteps = 200, dLambda = (lambda_max - lambda_min)/nSteps;
    let total = 0;
    for (let i = 0; i < nSteps; i++) {
        const lam = lambda_min + i*dLambda;
        total += planckPhotonFlux(lam, T) * dLambda;
    }
    return total;
}

// Updates flux arrays based on current parameters
const updateFluxArrays = () => {
    const telArea = Math.PI * (telDiameter/2)**2;
    if (!usePrism) {
        nonPrismFlux = totalPhotonFluxNonPrism(T_eff) * expTime * telArea;
    } else {
        const lambda_min = 300e-9, lambda_max = 900e-9;
        for (let x = 0; x < width; x++) {
            const lam = lambda_min + (lambda_max - lambda_min) * x / (width-1);
            const dLambda = (lambda_max - lambda_min)/width;
            prismFluxColumns[x] = planckPhotonFlux(lam, T_eff) * dLambda * expTime * telArea;
        }
    }
}

// Generates cosmic rays
const generateCosmicRays = (expTime) => {
    const rays = [];
    const numRays = Math.floor(Math.random() * 0.1 * expTime);
    for (let i = 0; i < numRays; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        const length = Math.floor(Math.random() * (50-3) + 3);
        const angle = Math.random() * 2 * Math.PI;
        rays.push({x, y, length, angle});
    }
    return rays;
}

// Simulates a single exposure
const simulateExposure = () => {
    
    const exposures = new Float32Array(width * height);

    // Iterates over every pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {

            // Calculates pixel offsets
            const dy = y - y0;
            const dx = x - x0;

            // Calculates total photon flux for prism / non-prism configurations
            const totalPhotons = usePrism ? prismFluxColumns[x] : nonPrismFlux;

            const psf = usePrism
                ? Math.exp(-(dy**2)/(2*seeing**2)) / (Math.sqrt(2*Math.PI)*seeing)
                : Math.exp(-(dx**2 + dy**2)/(2*seeing**2)) / (2*Math.PI*seeing**2);

            const signal = totalPhotons * psf / 1e14;

            // Randomly samples noise components
            const shotNoise = normalRandom(0, Math.sqrt(signal));
            const scintNoise = normalRandom(0, 0.00886 * telDiameter ** (-2/3) * airmass ** 1.75 * (2*expTime) ** (-1/2) * Math.exp(-altitude / 8000));

            exposures[y * width + x] = signal + shotNoise + scintNoise;
        }
    }

    return exposures
}

function drawSignal() {
    updateFluxArrays();

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const exposures = simulateExposure();

    // Determine max exposure for display scaling
    const scaleFactor = saturation > 0 ? 1 / saturation : 1;

    // Iterates over every pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {

            // Calculates pixel offsets
            const dx = x - x0;
            const idx = y * width + x;
            const i = 4 * idx;

            // Blacking out pixels outside the slit (non-prism mode)
            if (useSlit && Math.abs(dx) > slitSize/2 && !usePrism) {
                data[i] = 0;
                data[i+1] = 0;
                data[i+2] = 0;
                data[i+3] = 255;
            } 

            // Coloring saturated pixels red
            else if (exposures[idx] > saturation && useClipping) {
                data.set([255, 0, 0, 255], i);
            }

            // Coloring zero-clipped pixels blue
            else if (exposures[idx] <= 0 && useClipping) {
                data.set([0, 0, 255, 255], i);
            } 
            // Coloring normal pixels
            else {

                // Scale to 0-255 range
                let value = Math.round(exposures[idx] * scaleFactor * 255);
                value = Math.min(255, Math.max(0, value));
                const lambda = 300 + (900 - 300) * x / (width-1);

                // Apply approximate wavelength color mapping
                if (showColors && usePrism) {
                    const [r, g, b] = rgbFromWavelength(lambda);
                    data.set([r * value / 255, g * value / 255, b * value / 255, 255], i);
                } else {
                    data.set([value, value, value, 255], i);
                }

                // Add lamp contributions
                let lampContrib = [0, 0, 0];
                if (showHydrogenLamp) {
                    const c = simulateLampEmissions("hydrogen", lambda);
                    lampContrib[0] += c[0];
                    lampContrib[1] += c[1];
                    lampContrib[2] += c[2];
                }
                if (showHeliumLamp) {
                    const c = simulateLampEmissions("helium", lambda);
                    lampContrib[0] += c[0];
                    lampContrib[1] += c[1];
                    lampContrib[2] += c[2];
                }

                // Add lamp contributions if prism and slit are used
                if (usePrism && useSlit && (lampContrib[0] > 0 || lampContrib[1] > 0 || lampContrib[2] > 0)) { 
                    data[i]   = Math.min(255, data[i]   + lampContrib[0]);
                    data[i+1] = Math.min(255, data[i+1] + lampContrib[1]);
                    data[i+2] = Math.min(255, data[i+2] + lampContrib[2]);
                    data[i+3] = 255;
                }
            }
        }
    }

    // Cosmic rays
    if (useCosmicRays) {
    for (const ray of generateCosmicRays(expTime)) {
        const dx = Math.cos(ray.angle), dy = Math.sin(ray.angle);
        for (let l = 0; l < ray.length; l++) {
            const px = Math.round(ray.x + dx*l);
            const py = Math.round(ray.y + dy*l);
            if (px >= 0 && px < width && py >= 0 && py < height) {
                const i = 4 * (py * width + px);
                data[i] = 255; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
            }
        }
    }


}

    ctx.putImageData(imageData, 0, 0);
}


// Timer for periodic redraw
function restartTimer() {
    updateFluxArrays(); // update flux arrays once
    if (timerId) clearInterval(timerId);
    timerId = setInterval(drawSignal, expTime*1000); // draw periodically
    drawSignal(); // draw immediately
}

// Initialize
ctx.fillStyle = "black";
ctx.fillRect(0, 0, width, height);
restartTimer();

/////////////////////////////////////////////////////////////////
///                      Hook up sliders                      ///
/////////////////////////////////////////////////////////////////

document.getElementById("useCosmicRays").addEventListener("change", e => {
    useCosmicRays = e.target.checked;
    restartTimer();
});

document.getElementById("useClipping").addEventListener("change", e => {
    useClipping = e.target.checked;
    restartTimer();
});

document.getElementById("useSlit").addEventListener("change", e => {
    useSlit = e.target.checked;
    updateLampCheckboxes();
    restartTimer();
});

document.getElementById("usePrism").addEventListener("change", e => {
    usePrism = e.target.checked;
    updateLampCheckboxes();
    restartTimer();
});

document.getElementById("showColors").addEventListener("change", e => {
    showColors = e.target.checked;
    restartTimer();
});

document.getElementById("showHydrogenLamp").addEventListener("change", e => {
    showHydrogenLamp = e.target.checked;
    restartTimer();
});

document.getElementById("showHeliumLamp").addEventListener("change", e => {
    showHeliumLamp = e.target.checked;
    restartTimer();
});

document.getElementById("tempSlider").addEventListener("input", e => {
    T_eff = +e.target.value;
    document.getElementById("tempVal").textContent = T_eff;
    restartTimer();
});

document.getElementById("airmassSlider").addEventListener("input", e => {
    airmass = +e.target.value;
    document.getElementById("airmassVal").textContent = airmass;
    restartTimer();
});

document.getElementById("seeingSlider").addEventListener("input", e => {
    seeing = +e.target.value;
    document.getElementById("seeingVal").textContent = seeing;
    restartTimer();
});

document.getElementById("expSlider").addEventListener("input", e => {
    expTime = +e.target.value;
    document.getElementById("expVal").textContent = expTime;
    restartTimer();
});

document.getElementById("altSlider").addEventListener("input", e => {
    altitude = +e.target.value;
    document.getElementById("altVal").textContent = altitude;
    restartTimer();
});

document.getElementById("telSlider").addEventListener("input", e => {
    telDiameter = +e.target.value;
    document.getElementById("telVal").textContent = telDiameter;
    restartTimer();
});

document.getElementById("satSlider").addEventListener("input", e => {
    saturation = +e.target.value;
    document.getElementById("satVal").textContent = saturation;
    restartTimer();
});

document.getElementById("slitSlider").addEventListener("input", e => {
    slitSize = +e.target.value;
    document.getElementById("slitVal").textContent = slitSize;
    restartTimer();
});

// Fill black to avoid white flash
ctx.fillStyle = "black";
ctx.fillRect(0, 0, width, height);

// Then start the interval
restartTimer();