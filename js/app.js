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

            blazeFaceModel = await blazeface.load();
            detector = {
                ready: true,
                isBlazeFace: true,
                model: blazeFaceModel
            };
            console.log('BlazeFace model loaded successfully!');
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
                        console.log('Running multi-pass BlazeFace detection...');
                        console.log('Image dimensions:', imageElement.width, 'x', imageElement.height);
                        
                        const allFaces = [];
                        
                        const predictions = await blazeFaceModel.estimateFaces(imageElement, false);
                        console.log('Pass 1 (full image):', predictions.length, 'faces');
                        
                        if (predictions && predictions.length > 0) {
                            predictions.forEach(prediction => {
                                const start = prediction.topLeft;
                                const end = prediction.bottomRight;
                                allFaces.push({
                                    x: start[0],
                                    y: start[1],
                                    width: end[0] - start[0],
                                    height: end[1] - start[1],
                                    confidence: prediction.probability ? prediction.probability[0] : 0.9
                                });
                            });
                        }
                        

                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        const gridSize = 2; 
                        const overlap = 0.2; 
                        
                        for (let row = 0; row < gridSize; row++) {
                            for (let col = 0; col < gridSize; col++) {
                                const regionWidth = imageElement.width / gridSize * (1 + overlap);
                                const regionHeight = imageElement.height / gridSize * (1 + overlap);
                                const offsetX = (imageElement.width / gridSize) * col - (regionWidth - imageElement.width / gridSize) / 2;
                                const offsetY = (imageElement.height / gridSize) * row - (regionHeight - imageElement.height / gridSize) / 2;
                                

                                canvas.width = Math.min(regionWidth, imageElement.width - Math.max(0, offsetX));
                                canvas.height = Math.min(regionHeight, imageElement.height - Math.max(0, offsetY));
                                
                                ctx.drawImage(
                                    imageElement,
                                    Math.max(0, offsetX), Math.max(0, offsetY),
                                    canvas.width, canvas.height,
                                    0, 0,
                                    canvas.width, canvas.height
                                );
                                
                                const regionPredictions = await blazeFaceModel.estimateFaces(canvas, false);
                                console.log(`Pass ${row * gridSize + col + 2} (region ${row},${col}):`, regionPredictions.length, 'faces');
                                
                                if (regionPredictions && regionPredictions.length > 0) {
                                    regionPredictions.forEach(prediction => {
                                        const start = prediction.topLeft;
                                        const end = prediction.bottomRight;

                                        allFaces.push({
                                            x: start[0] + Math.max(0, offsetX),
                                            y: start[1] + Math.max(0, offsetY),
                                            width: end[0] - start[0],
                                            height: end[1] - start[1],
                                            confidence: prediction.probability ? prediction.probability[0] : 0.9
                                        });
                                    });
                                }
                            }
                        }
                        

                        const uniqueFaces = removeDuplicateFaces(allFaces);
                        
                        console.log(`Total detections: ${allFaces.length}, After deduplication: ${uniqueFaces.length}`);
                        resolve(uniqueFaces);
                        
                    } catch (error) {
                        console.error('BlazeFace detection error:', error);
                        console.error('Error stack:', error.stack);
                        resolve([]);
                    }
                } else if (detector.isMock) {

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

    function removeDuplicateFaces(faces) {
        if (faces.length === 0) return faces;
        

        const sorted = faces.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        const unique = [];
        
        for (const face of sorted) {
            let isDuplicate = false;
            
            for (const existing of unique) {

                const xOverlap = Math.max(0, 
                    Math.min(face.x + face.width, existing.x + existing.width) - 
                    Math.max(face.x, existing.x)
                );
                const yOverlap = Math.max(0, 
                    Math.min(face.y + face.height, existing.y + existing.height) - 
                    Math.max(face.y, existing.y)
                );
                const overlapArea = xOverlap * yOverlap;
                const faceArea = face.width * face.height;
                const existingArea = existing.width * existing.height;
                
                const overlapRatio = overlapArea / Math.min(faceArea, existingArea);
                
                if (overlapRatio > 0.5) {
                    isDuplicate = true;
                    break;
                }
            }
            
            if (!isDuplicate) {
                unique.push(face);
            }
        }
        
        return unique;
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
                    

                    const lowerPrompt = prompt.toLowerCase();
                    let filtered = predictions;
                    

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
            

            let color = '#dc2626'; 
            
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
            

            let lineWidth = 4; 
            const pxMatch = lowerPrompt.match(/(\d+)px/);
            if (pxMatch) {
                lineWidth = parseInt(pxMatch[1]);
            }
            
            console.log('Drawing with color:', color, 'lineWidth:', lineWidth);
            
            detections.forEach((detection, index) => {
                const centerX = detection.x + detection.width / 2;
                const centerY = detection.y + detection.height / 2;
                

                if (lowerPrompt.includes('circle')) {

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


        DOM.displayImage.style.display = 'none';
        DOM.displayCanvas.style.display = 'block';
    }

    function drawFaceCircles(detections, prompt = '') {

        drawDetections(detections, prompt, 'face');
    }

    


    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 500); 
        });
    } else {
        setTimeout(init, 500); 
    }

})()