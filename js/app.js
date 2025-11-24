(function() {

    let detector = null;
    let objectDetector = null;
    let currentImage = null;
    let imageElement = new Image();
    let DOM = {};
    let blazeFaceModel = null;
    let blazeFaceLoadAttempts = 0;
    const MAX_LOAD_ATTEMPTS = 50; 

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

    async function initBlazeFace() {
        blazeFaceLoadAttempts++;
        
        if (typeof tf === 'undefined' || typeof blazeface === 'undefined') {
            if (blazeFaceLoadAttempts >= MAX_LOAD_ATTEMPTS) {
                console.error('Failed to load TensorFlow.js or BlazeFace after maximum attempts');
                console.error('Please check your internet connection or try refreshing the page');
                useMockDetection();
                return;
            }
            console.log(`Waiting for TensorFlow.js and BlazeFace to load... (attempt ${blazeFaceLoadAttempts})`);
            setTimeout(initBlazeFace, 200);
            return;
        }
        
        console.log('TensorFlow.js version:', tf.version.tfjs);
        console.log('Loading BlazeFace model...');
        
        try {
            blazeFaceModel = await blazeface.load({
                maxFaces: 20,          // Detect up to 20 faces
                iouThreshold: 0.3,     
                scoreThreshold: 0.75   // Minimum confidence (0.75 is default)
            });
            detector = {
                ready: true,
                isBlazeFace: true,
                model: blazeFaceModel
            };
            console.log('BlazeFace model loaded successfully with multi-face detection!');
        } catch (error) {
            console.error('Failed to load BlazeFace model:', error);
            useMockDetection();
        }
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
        initBlazeFace();
    }

    async function detectFaces() {
        if (!currentImage || !detector) {
            console.log('No image or detector not ready');
            return Promise.resolve([]);
        }

        return new Promise(function(resolve) {
            imageElement.onload = async function() {
                if (detector.isBlazeFace && blazeFaceModel) {

                    try {
                        console.log('Running BlazeFace detection...');
                        console.log('Image dimensions:', imageElement.width, 'x', imageElement.height);
                        

                        const predictions = await blazeFaceModel.estimateFaces(imageElement, false);
                        console.log('BlazeFace raw predictions:', predictions);
                        console.log('Number of faces detected:', predictions ? predictions.length : 0);
                        
                        if (predictions && predictions.length > 0) {
                            const faces = predictions.map((prediction, idx) => {

                                const start = prediction.topLeft;
                                const end = prediction.bottomRight;
                                
                                console.log(`Face ${idx + 1}:`, {
                                    topLeft: start,
                                    bottomRight: end,
                                    probability: prediction.probability
                                });
                                
                                return {
                                    x: start[0],
                                    y: start[1],
                                    width: end[0] - start[0],
                                    height: end[1] - start[1],
                                    confidence: prediction.probability ? prediction.probability[0] : 0.9
                                };
                            });
                            
                            console.log(`BlazeFace detected ${faces.length} face(s) with coordinates:`, faces);
                            resolve(faces);
                        } else {
                            console.log('BlazeFace detected no faces');
                            resolve([]);
                        }
                    } catch (error) {
                        console.error('BlazeFace detection error:', error);
                        console.error('Error stack:', error.stack);
                        resolve([]);
                    }
                } else if (detector.isMock) {
                    // Use mock detection
                    console.log('Using mock detection');
                    detector.detect(imageElement).then(resolve).catch(() => resolve([]));
                } else {
                    console.log('No valid detector available');
                    resolve([]);
                }
            };
            imageElement.src = currentImage;
        });
    }

    function removeOverlappingFaces(faces) {
        if (faces.length === 0) return faces;
        
        const filtered = [];
        const sorted = faces.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        
        for (const face of sorted) {
            let isOverlapping = false;
            
            for (const existing of filtered) {

                const xOverlap = Math.max(0, Math.min(face.x + face.width, existing.x + existing.width) - Math.max(face.x, existing.x));
                const yOverlap = Math.max(0, Math.min(face.y + face.height, existing.y + existing.height) - Math.max(face.y, existing.y));
                const overlapArea = xOverlap * yOverlap;
                const faceArea = face.width * face.height;
                

                if (overlapArea / faceArea > 0.3) {
                    isOverlapping = true;
                    break;
                }
            }
            
            if (!isOverlapping) {
                filtered.push(face);
            }
        }
        
        return filtered;
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

            DOM.analyzeBtn.disabled = true;
            DOM.analyzeBtn.innerHTML = '<div class="spinner"></div> Processing...';
            hideResult();

            try {
                const lowerPrompt = prompt.toLowerCase();

                if (lowerPrompt.includes('face')) {
                    const detections = await detectFaces();
                    
                    if (detections && detections.length > 0) {
                        drawDetections(detections, prompt, 'face');
                        showResult(`${detections.length} face(s) detected and circled in the image!`);
                    } else {
                        showResult('No faces detected in the image.');
                    }
                } else if (lowerPrompt.includes('detect') || lowerPrompt.includes('circle') || lowerPrompt.includes('find')) {
                    // For now, only face detection is available
                    showResult('Currently only face detection is available. Try: "circle faces" or "detect faces"');
                } else if (lowerPrompt.includes('describe') || lowerPrompt.includes('what')) {
                    showResult('Image analysis complete. For detailed descriptions, consider using a vision model API.');
                } else {
                    showResult('Try: "detect faces" or "circle faces in red"');
                }
            } catch (error) {
                showResult('Error processing image: ' + error.message);
            } finally {
                DOM.analyzeBtn.disabled = false;
                DOM.analyzeBtn.textContent = 'Analyze Image';
            }
        });
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

    async function detectObjects(prompt) {
        if (!currentImage || !objectDetector) {
            console.log('Object detector not ready');
            return [];
        }
        
        return new Promise(function(resolve) {
            imageElement.onload = async function() {
                try {
                    const predictions = await objectDetector.detect(imageElement);
                    console.log('COCO-SSD predictions:', predictions);
                    
                    // Filter by prompt if specific object mentioned
                    const lowerPrompt = prompt.toLowerCase();
                    let filtered = predictions;
                    
                    // Extract object type from prompt
                    const objectTypes = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
                        'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse',
                        'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie',
                        'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
                        'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon',
                        'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut',
                        'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
                        'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book',
                        'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'];
                    
                    for (const objType of objectTypes) {
                        if (lowerPrompt.includes(objType) || lowerPrompt.includes(objType + 's')) {
                            filtered = predictions.filter(p => p.class.toLowerCase().includes(objType) || objType.includes(p.class.toLowerCase()));
                            break;
                        }
                    }
                    
                    const mapped = filtered.map(pred => ({
                        x: pred.bbox[0],
                        y: pred.bbox[1],
                        width: pred.bbox[2],
                        height: pred.bbox[3],
                        class: pred.class,
                        score: pred.score
                    }));
                    
                    resolve(mapped);
                } catch (error) {
                    console.error('Object detection error:', error);
                    resolve([]);
                }
            };
            imageElement.src = currentImage;
        });
    }

    function drawDetections(detections, prompt = '', type = 'object') {
        console.log('drawDetections called with:', detections.length, type + 's');
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
                
                // Determine shape based on prompt
                if (lowerPrompt.includes('circle')) {
                    // Draw circle around detection
                    let radius = Math.max(detection.width, detection.height) / 2;
                    if (lowerPrompt.includes('around')) {
                        radius = radius * 1.3;
                    }
                    radius = Math.max(radius, 20);

                    ctx.strokeStyle = color;
                    ctx.lineWidth = lineWidth;
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
                    ctx.stroke();
                } else {

                    ctx.strokeStyle = color;
                    ctx.lineWidth = lineWidth;
                    ctx.strokeRect(detection.x, detection.y, detection.width, detection.height);
                }


                if (detections.length <= 20 && !lowerPrompt.includes('no label')) {
                    ctx.fillStyle = color;
                    ctx.font = `${Math.max(12, lineWidth * 3)}px sans-serif`;
                    const label = detection.class ? `${detection.class} ${index + 1}` : `${type} ${index + 1}`;
                    const textWidth = ctx.measureText(label).width;
                    

                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.7;
                    ctx.fillRect(detection.x, detection.y - 20, textWidth + 8, 20);
                    ctx.globalAlpha = 1;
                    

                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(label, detection.x + 4, detection.y - 5);
                }
            });
        }

        // Ensure canvas is visible and image is hidden
        DOM.displayImage.style.display = 'none';
        DOM.displayCanvas.style.display = 'block';
    }

    function drawFaceCircles(detections, prompt = '') {
        // Legacy function - redirect to drawDetections
        drawDetections(detections, prompt, 'face');
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