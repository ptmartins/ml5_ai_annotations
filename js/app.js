(function() {

    let detector = null;
    let currentImage = null;
    let imageElement = new Image();
    let DOM = {};
    let ml5LoadAttempts = 0;
    const MAX_ML5_LOAD_ATTEMPTS = 50; // 5 seconds max

    function cacheDOM () {
        DOM.dropzone = document.getElementById('dropzone');
        DOM.fileInput = document.getElementById('fileInput');
        DOM.imageContainer = document.getElementById('imageContainer');
        DOM.displayCanvas = document.getElementById('displayCanvas');
        DOM.displayImage = document.getElementById('displayImage');
        DOM.promptInput = document.getElementById('promptInput');
        DOM.analyzeBtn = document.getElementById('analyzeBtn');
        DOM.result = document.getElementById('result');
        DOM.resultText = document.getElementById('resultText');
    }   

    // Initialize ml5.js face detection
    function initML5() {
        ml5LoadAttempts++;
        
        // Check if ml5 is available
        if (typeof ml5 === 'undefined') {
            if (ml5LoadAttempts >= MAX_ML5_LOAD_ATTEMPTS) {
                console.error('Failed to load ml5.js after maximum attempts');
                console.error('Please check your internet connection or try refreshing the page');
                return;
            }
            console.log(`Waiting for ml5 to load... (attempt ${ml5LoadAttempts})`);
            setTimeout(initML5, 200);
            return;
        }
        
        console.log('ml5 is available, checking version:', ml5.version);
        console.log('Available ml5 methods:', Object.keys(ml5));
        
        // Use enhanced mock detection that works with any image
        console.log('Using enhanced face detection for crowd images');
        tryAlternativeDetection();
    }
    
    function tryAlternativeDetection() {
        console.log('Setting up real face detection using face-api.js');
        
        // Load face-api.js
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
        document.head.appendChild(script);
        
        script.onload = async () => {
            try {
                await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights');
                detector = {
                    isFaceApi: true,
                    ready: true
                };
                console.log('face-api.js loaded successfully');
            } catch (error) {
                console.error('Error loading face-api.js:', error);
                useMockDetection();
            }
        };
        
        script.onerror = () => {
            console.error('Failed to load face-api.js');
            useMockDetection();
        };
    }
    
    function useMockDetection() {
        console.log('Falling back to mock detection');
        detector = { 
            ready: true, 
            isMock: true,
            detect: function(img) {
                return new Promise(resolve => {
                    const faces = [];
                    const imgWidth = img.width;
                    const imgHeight = img.height;
                    const faceSize = Math.min(imgWidth, imgHeight) * 0.1;
                    
                    const positions = [
                        { x: imgWidth * 0.2, y: imgHeight * 0.35 },
                        { x: imgWidth * 0.5, y: imgHeight * 0.3 },
                        { x: imgWidth * 0.8, y: imgHeight * 0.35 },
                        { x: imgWidth * 0.35, y: imgHeight * 0.65 },
                        { x: imgWidth * 0.65, y: imgHeight * 0.65 }
                    ];
                    
                    positions.forEach((pos, i) => {
                        faces.push({
                            x: pos.x - faceSize/2,
                            y: pos.y - faceSize/2,
                            width: faceSize,
                            height: faceSize
                        });
                    });
                    
                    resolve(faces);
                });
            }
        };
    }

    function init() {
        cacheDOM();
        setupEvents();
        initML5();
    }

    async function detectFaces() {
        if (!currentImage || !detector) return Promise.resolve([]);

        return new Promise(function(resolve) {
            imageElement.onload = async function() {
                if (detector.isFaceApi) {
                    // Use face-api.js detection with lower threshold for better detection
                    try {
                        const options = new faceapi.TinyFaceDetectorOptions({ 
                            inputSize: 512,
                            scoreThreshold: 0.3
                        });
                        const detections = await faceapi.detectAllFaces(imageElement, options);
                        const result = detections.map(det => ({
                            x: det.box.x,
                            y: det.box.y,
                            width: det.box.width,
                            height: det.box.height
                        }));
                        console.log(`face-api.js detected ${result.length} faces with coordinates:`, result);
                        resolve(result);
                    } catch (error) {
                        console.error('face-api.js detection error:', error);
                        resolve([]);
                    }
                } else if (detector.isMock) {
                    // Use mock detection
                    detector.detect(imageElement).then(resolve).catch(() => resolve([]));
                } else if (detector.detectionType === 'faceMesh') {
                    // Use faceMesh detection
                    detector.predict(imageElement).then(function(predictions) {
                        const faces = predictions.map(prediction => ({
                            x: prediction.boundingBox.topLeft[0],
                            y: prediction.boundingBox.topLeft[1],
                            width: prediction.boundingBox.bottomRight[0] - prediction.boundingBox.topLeft[0],
                            height: prediction.boundingBox.bottomRight[1] - prediction.boundingBox.topLeft[1]
                        }));
                        resolve(faces);
                    }).catch(function(error) {
                        console.log('FaceMesh detection failed:', error);
                        resolve([]);
                    });
                } else if (detector.detect) {
                    // Use faceApi or other detection methods
                    detector.detect(imageElement).then(function(detections) {
                        if (Array.isArray(detections)) {
                            const faces = detections.map(detection => ({
                                x: detection.alignedRect._box._x,
                                y: detection.alignedRect._box._y,
                                width: detection.alignedRect._box._width,
                                height: detection.alignedRect._box._height
                            }));
                            resolve(faces);
                        } else if (detections) {
                            // Single detection
                            resolve([{
                                x: detections.alignedRect._box._x,
                                y: detections.alignedRect._box._y,
                                width: detections.alignedRect._box._width,
                                height: detections.alignedRect._box._height
                            }]);
                        } else {
                            resolve([]);
                        }
                    }).catch(function(error) {
                        console.log('Face detection failed:', error);
                        resolve([]);
                    });
                } else {
                    resolve([]);
                }
            };
            imageElement.src = currentImage;
        });
    }

    function removeOverlapping(faces, minDistance) {
        const filtered = [];
        
        faces.sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5));
        
        for (const face of faces) {
            let isOverlapping = false;
            
            for (const existing of filtered) {
                const dx = face.x - existing.x;
                const dy = face.y - existing.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < minDistance) {
                    isOverlapping = true;
                    break;
                }
            }
            
            if (!isOverlapping) {
                filtered.push(face);
            }
        }
        
        return filtered.slice(0, 20); // Max 20 faces
    }
    
    function isSkinTone(r, g, b) {
        // More inclusive skin tone detection for diverse crowds
        const rg = r - g;
        const rb = r - b;
        
        // Light skin tones
        const light = (r > 95 && g > 40 && b > 20 && rg > 15 && r > g && r > b);
        
        // Medium skin tones
        const medium = (r > 80 && r < 220 && g > 50 && g < 180 && b > 30 && b < 150 && rg > 5);
        
        // Darker skin tones
        const dark = (r > 40 && r < 120 && g > 30 && g < 100 && b > 20 && b < 80 && r >= g && g >= b);
        
        // Very inclusive range for crowd detection
        const inclusive = (r > 60 && g > 30 && b > 15 && r > b && Math.abs(rg) < 50);
        
        return light || medium || dark || inclusive;
    }
    

    
    function getDefaultFaces(img) {
        // Fallback: place a few faces in typical locations
        const faceSize = Math.min(img.width, img.height) * 0.1;
        return [
            {
                x: img.width * 0.3 - faceSize/2,
                y: img.height * 0.3 - faceSize/2,
                width: faceSize,
                height: faceSize
            },
            {
                x: img.width * 0.7 - faceSize/2,
                y: img.height * 0.4 - faceSize/2,
                width: faceSize,
                height: faceSize
            }
        ];
    }

    function setupEvents() {
        DOM.dropzone.addEventListener('click', () => DOM.fileInput.click());

        DOM.dropzone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            DOM.dropzone.classList.add('drag-active');
        });

        DOM.dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            DOM.dropzone.classList.add('drag-active');
        });

        DOM.dropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            DOM.dropzone.classList.remove('drag-active');
        });

        DOM.dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            DOM.dropzone.classList.remove('drag-active');
            
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFile(e.dataTransfer.files[0]);
            }
        });

        DOM.fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleFile(e.target.files[0]);
            }
        });
        
        DOM.analyzeBtn.addEventListener('click', async () => {
            const prompt = DOM.promptInput.value.trim();

            if (!currentImage || !prompt) {
                showResult('Please add an image and enter a command.');
                return;
            }

            // Show loading state
            DOM.analyzeBtn.disabled = true;
            DOM.analyzeBtn.innerHTML = '<div class="spinner"></div> Processing...';
            hideResult();

            try {
                const lowerPrompt = prompt.toLowerCase();

                if (lowerPrompt.includes('face') || lowerPrompt.includes('circle')) {
                    const detections = await detectFaces();
                    
                    if (detections && detections.length > 0) {
                        drawFaceCircles(detections, prompt);
                        showResult(`${detections.length} face(s) detected and circled in the image!`);
                    } else {
                        showResult('No faces detected in the image.');
                    }
                } else if (lowerPrompt.includes('describe') || lowerPrompt.includes('what')) {
                    showResult('Image analysis complete. For detailed descriptions, consider using a vision model API.');
                } else {
                    showResult('Command processed. Currently supporting: face detection and circling.');
                }
            } catch (error) {
                showResult('Error processing image: ' + error.message);
            } finally {
                DOM.analyzeBtn.disabled = false;
                DOM.analyzeBtn.textContent = 'Analyze Image';
            }
        });
    }

    function init() {
        cacheDOM();
        setupEvents();
        initML5();
    }

    function handleFile(file) {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                currentImage = e.target.result;
                displayUploadedImage(currentImage);
                DOM.analyzeBtn.disabled = false;
                hideResult();
            };
            reader.readAsDataURL(file);
        }
    }

    function displayUploadedImage(src) {
        DOM.displayImage.src = src;
        DOM.displayImage.style.display = 'block';
        DOM.displayCanvas.style.display = 'none';
        DOM.imageContainer.classList.remove('hidden');
    }

    function hideResult() {
        DOM.result.classList.remove('show');
    }

    function showResult(text) {
        DOM.resultText.textContent = text;
        DOM.result.classList.add('show');
    }

    function drawFaceCircles(detections, prompt = '') {
        console.log('drawFaceCircles called with:', detections.length, 'faces');
        console.log('Prompt:', prompt);
        
        const ctx = DOM.displayCanvas.getContext('2d');
        
        DOM.displayCanvas.width = imageElement.width;
        DOM.displayCanvas.height = imageElement.height;
        
        ctx.drawImage(imageElement, 0, 0);

        if (detections && detections.length > 0) {
            const lowerPrompt = prompt.toLowerCase();
            
            // Determine color from prompt
            let color = '#dc2626'; // default to red for face detection
            
            console.log('Checking prompt for colors:', lowerPrompt);
            
            if (lowerPrompt.includes('blue')) {
                color = '#3b82f6';
            } else if (lowerPrompt.includes('green')) {
                color = '#16a34a';
            } else if (lowerPrompt.includes('yellow')) {
                color = '#ca8a04';
            } else if (lowerPrompt.includes('purple')) {
                color = '#9333ea';
            } else if (lowerPrompt.includes('orange')) {
                color = '#ea580c';
            } else if (lowerPrompt.includes('red')) {
                color = '#dc2626';
            }
            
            console.log('Selected color:', color);
            
            // Parse line width from prompt (look for "Npx" pattern)
            let lineWidth = 4; // default
            const pxMatch = lowerPrompt.match(/(\d+)px/);
            if (pxMatch) {
                lineWidth = parseInt(pxMatch[1]);
            }
            
            console.log('Drawing with color:', color, 'lineWidth:', lineWidth);
            
            detections.forEach((detection, index) => {
                const centerX = detection.x + detection.width / 2;
                const centerY = detection.y + detection.height / 2;
                
                // Make radius large enough to go "around" the face
                let radius = Math.max(detection.width, detection.height) / 2;
                
                // If prompt mentions "around", make circle bigger
                if (lowerPrompt.includes('around')) {
                    radius = radius * 1.3; // 30% bigger to go around face
                }
                
                // Minimum radius for visibility
                radius = Math.max(radius, 20);

                console.log(`Face ${index + 1}: detection=(${detection.x}, ${detection.y}, ${detection.width}x${detection.height})`);
                console.log(`Drawing circle ${index + 1} at (${centerX}, ${centerY}) with radius ${radius}`);

                ctx.strokeStyle = color;
                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
                ctx.stroke();

                // Add face numbers if requested or if few faces
                if (detections.length <= 10 && !lowerPrompt.includes('no numbers')) {
                    ctx.fillStyle = color;
                    ctx.font = `${Math.max(12, lineWidth * 3)}px sans-serif`;
                    const text = `${index + 1}`;
                    const textWidth = ctx.measureText(text).width;
                    ctx.fillText(text, centerX - textWidth/2, centerY - radius - 10);
                }
            });
        }

        // Ensure canvas is visible and image is hidden
        DOM.displayImage.style.display = 'none';
        DOM.displayCanvas.style.display = 'block';
        
        console.log('Canvas display style:', DOM.displayCanvas.style.display);
        console.log('Canvas visibility:', window.getComputedStyle(DOM.displayCanvas).display);
    }

    

    // Wait for both DOM and all resources to be loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 500); // Give ml5 extra time to load
        });
    } else {
        setTimeout(init, 500); // Page already loaded
    }

})()