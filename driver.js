"use strict";

// TODO: refactor AI training to be more async
// TODO: split blob-file into smaller parts
// TODO: add unit tests
// TODO: migrate to tensorflow.js / tensorspace.org
// TODO: migrate to TypeScript ?

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  arr() {
    return [this.x, this.y];
  }
}

class Circle {
  constructor(center, radius) {
    this.center = center;
    this.radius = radius;
  }
}

class Wall {
  #minx; #maxx; #miny; #maxy;  // precomputed often used values
  
  constructor(x1, y1, x2, y2) {
    this.point1 = new Point(x1, y1);
    this.point2 = new Point(x2, y2);
    const epsilon = 0.001; // add very small tolerance due to floating rounding
    this.#minx = Math.min(x1,x2) - epsilon;
    this.#maxx = Math.max(x1,x2) + epsilon;
    this.#miny = Math.min(y1,y2) - epsilon;
    this.#maxy = Math.max(y1,y2) + epsilon;
  }

  intersectOnWall(point1, point2) {
    const intersec = math.intersect(point1.arr(), point2.arr(), this.point1.arr(), this.point2.arr());
    if (intersec === null) return null;  // no hit: parallel    
    // math.intersect do not respect start and end of wall, thus we need to clip manually
    const x = intersec[0];
    const y = intersec[1];
    const isOnWall = (x >= this.#minx && x <= this.#maxx) && (y >= this.#miny && y <= this.#maxy);
    return isOnWall ? new Point(x, y) : null;
  }

  hitsCar(car) {
    const dx = this.point2.x - this.point1.x;
    const dy = this.point2.y - this.point1.y;
    const wallOrthogonal = new Point(car.position.x - dy, car.position.y + dx);
    const wallPoint = this.intersectOnWall(car.position, wallOrthogonal)
    if (wallPoint === null) return false;
    car.addDistancePoint(wallPoint);
    //console.log("wall:", this.point1, this.point2, "wallOrthogonal:", wallOrthogonal, "wallPoint:", wallPoint);
    const distanceToWall = math.distance(car.position.arr(), wallPoint.arr());
    return distanceToWall < Car.VOLUMNE;
  }
}

class TrackMap {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.clear();
  }

  clear() {
    this.walls = [];
    // add surrounding rect
    this.addRect(0, 0, this.width, this.height);
    // add goal
    this.goal = new Circle(new Point(this.width * 0.9, this.height * 0.9), 20);
  }

  save(filename) {
    const data = JSON.stringify(this);
    var a = document.getElementById("a");
    a.href = window.URL.createObjectURL(new Blob([data], {type: "text/plain"}));
    a.download = filename;
    a.click(); 
  }

  load(file) {
    const reader = new FileReader();
    reader.addEventListener('load', (event) => {
      const parsedData = JSON.parse(event.target.result);
      this.width = parsedData.width;
      this.height = parsedData.height;
      // we require to cast json object for correct classes to use functions like arr and hit and to precompute private values #min/max x/y
      this.walls = parsedData.walls.map(wall => new Wall(wall.point1.x, wall.point1.y, wall.point2.x, wall.point2.y));
      this.goal = new Circle(new Point(parsedData.goal.center.x, parsedData.goal.center.y), parsedData.goal.radius);
      trackmap_ui.refresh();
    });
    reader.readAsText(file);
  }

  addWall(wall) {
    this.walls.push(wall);
  }

  addRect(x1, y1, x2, y2) {
    this.addWall(new Wall(x1, y1, x2, y1));
    this.addWall(new Wall(x1, y1, x1, y2));
    this.addWall(new Wall(x2, y1, x2, y2));
    this.addWall(new Wall(x1, y2, x2, y2));
  }

  addRandomWalls(amount) {
    for (let i = 0; i < amount; i++) {
      const x1 = Math.random() * this.width;
      const y1 = Math.random() * this.height;
      const x2 = Math.random() * this.width;
      const y2 = Math.random() * this.height;
      this.addWall(new Wall(x1, y1, x2, y2));
    }
  }

  inGoal(point) {
    return this.distance2goal(point) <= this.goal.radius;
  }

  distance2goal(point) {
    return math.distance(point.arr(),this.goal.center.arr());
  }

  hitsWall(car) {
    for (let wall of this.walls) {
      if (wall.hitsCar(car)) return true;
    }
    return false;
  }
}

class TrackMapPainter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  paint(trackMap) {
    // floor
    this.ctx.fillStyle = "white";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // goal
    this.ctx.fillStyle = "green";
    this.ctx.beginPath();
    this.ctx.arc(trackMap.goal.center.x, trackMap.goal.center.y, trackMap.goal.radius, 0, 2 * Math.PI);
    this.ctx.fill();

    // walls
    this.ctx.strokeStyle = "black";
    for (let wall of trackMap.walls) {
      this.ctx.beginPath();
      this.ctx.moveTo(wall.point1.x, wall.point1.y);
      this.ctx.lineTo(wall.point2.x, wall.point2.y);
      this.ctx.stroke();
    }
  }
}

class Sensor { 
  constructor(steeringOffset) {
    this.steeringOffset = steeringOffset;
    this.distance = Infinity;
    this.hit = null;
  }

  /**
   * Scans the trackMap for the nearest wall and returns the distance to it.
   * Updates internal values 'distance', 'hit'.
   * @param {TrackMap} trackMap - The trackMap to scan.
   * @returns {number} - The distance to the nearest wall as 0..1 (unified to TrackMap.width)
   */
  scan(car, trackMap) {  // hard to implement for AI!
    const radians = (car.steering + this.steeringOffset) * Math.PI / 180;
    const dx = Math.cos(radians);
    const dy = Math.sin(radians);
    const usex = Math.abs(dx) > Math.abs(dy);
    const scanEnd = new Point(car.position.x + dx, car.position.y + dy);
    
    this.distance = Infinity;
    let minIntersec = null;
    for (let wall of trackMap.walls) {
      this._scanWall(wall, car.position, scanEnd, dx, dy, usex);
    }

    return this.distance / trackMap.width;
  }
  
  _scanWall(wall, scanStart, scanEnd, dx, dy, usex) {
    const hit = wall.intersectOnWall(scanStart, scanEnd);    
    if (hit === null) return;
    // we need the direction of the distance, thus we can not use math.distance (is absolute value)
    const distance = usex ? (hit.x - scanStart.x) / dx : (hit.y - scanStart.y) / dy;
    if (distance < 0) return;
    if (distance < this.distance) {
      this.distance = distance;
      this.hit = hit;
    }
  }

  static createSensors(range, sensorAmount) {
    const inc = 2*range/(sensorAmount+1)
    const offsets = Array.from({length: sensorAmount}, (_, i) => (i + 1) * inc - range);
    return offsets.map(x => new Sensor(x));
  }
}

class SensorPainter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  paint(car, sensor) {
    this.ctx.strokeStyle = "gold";
    this.ctx.beginPath();
    this.ctx.moveTo(car.position.x, car.position.y);
    this.ctx.lineTo(sensor.hit.x, sensor.hit.y);
    this.ctx.stroke();
  }
}


class Car {
  static WIDTH = 50;
  static HEIGHT = Car.WIDTH / 2;
  static VOLUMNE = Car.WIDTH / 2.5;
  
  constructor(position, steering, speed, sensorAmount) {
    this.position = position;
    this.steering = steering;
    this.speed = speed;
    this.sensors = Sensor.createSensors(50, sensorAmount);  // access via CarPainter + ui => non-private
    this.distancePoints = [];  // access via CarPainter => non-private
  }

  /**
   * Static copy constructor.
   * @param {Car} car - The car to copy.
   * @returns {Car} - The copied car.
   */
  static copy(car) {
    return new Car(new Point(car.position.x, car.position.y), car.steering, car.speed, car.sensors.length);
  }

  readSensors(trackMap) {
    this.inGoal = trackMap.inGoal(this.position);
    if (this.inGoal) console.log("Goal!")
    this.distancePoints = []
    this.isCrash = trackMap.hitsWall(this)
    if (this.isCrash) console.log("Crash!")
    return this.sensors.map(sensor => sensor.scan(this, trackMap));
  }

  addDistancePoint(p) {
    this.distancePoints.push(p);
  }

  move() {
    const radians = this.steering * Math.PI / 180;
    const dx = Math.cos(radians) * this.speed;
    const dy = Math.sin(radians) * this.speed;
    this.position.x += dx;
    this.position.y += dy;
  }

  moveBack() {
    const radians = this.steering * Math.PI / 180;
    const dx = Math.cos(radians) * this.speed;
    const dy = Math.sin(radians) * this.speed;
    this.position.x -= dx;
    this.position.y -= dy;
  }
  
  debug() {
    console.log("Position:", this.position, "Steering:", this.steering, "Speed:", this.speed);
  }
}

class CarPainter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sensorPainter = new SensorPainter(canvas);
    this.showSensors = true;
    this.showWallDistances = false;
  }

  paint(car) {
    if (this.showSensors) {
      for (let sensor of car.sensors) { this.sensorPainter.paint(car, sensor); }
    }
    
    if (this.showWallDistances) {
      for (let p of car.distancePoints) {
        this.ctx.strokeStyle = "pink";
        this.ctx.beginPath();
        this.ctx.moveTo(car.position.x, car.position.y);
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();
      }
    }
    
    const radians = car.steering * Math.PI / 180;
    this.ctx.fillStyle = car.isCrash ? "red" : "blue";
    this.ctx.save();
    this.ctx.translate(car.position.x, car.position.y);
    this.ctx.rotate(radians);
    const w_2 = Car.WIDTH / 2;
    const h_2 = Car.HEIGHT / 2;
    this.ctx.fillRect(-w_2, -h_2, Car.WIDTH, Car.HEIGHT);
    this.ctx.fillStyle = "black";
    const tireWidth = Car.WIDTH / 5;
    const tireHeight = Car.HEIGHT / 7;
    this.ctx.fillRect(-w_2 + tireWidth, -h_2, tireWidth, -tireHeight);
    this.ctx.fillRect(+w_2 - tireWidth, -h_2, -tireWidth, -tireHeight);
    this.ctx.fillRect(-w_2 + tireWidth, h_2, tireWidth, tireHeight);
    this.ctx.fillRect(+w_2 - tireWidth, h_2, -tireWidth, tireHeight);
    this.ctx.fillStyle = "lightblue";
    this.ctx.fillRect(0, -h_2 + tireHeight, w_2 - 3*tireHeight, Car.HEIGHT - 2*tireHeight);
    this.ctx.restore();
    
    if (car.inGoal) {
      this.ctx.fillStyle = "green";
      this.ctx.font = "bold 100px Arial";
      this.ctx.textAlign = "center";
      this.ctx.fillText("GOAL!", this.canvas.width/2, this.canvas.height/2);
    }
    //car.debug();
  }
}

// =========================== AI driver logic

class Neuron {
  constructor(weights, bias) {
    this.weights = weights;
    this.bias = bias;
  }

  feedForward(inputs) {
    let weightedSum = 0;
    for (let i = 0; i < inputs.length; i++) {
      weightedSum += inputs[i] * this.weights[i];
    }
    weightedSum += this.bias;
    return weightedSum;
  }
}

class HiddenLayerNeuron extends Neuron {
  leakReLU(x) {
    if (x < 0) {
      return 0.1 * x;
    }
    return x;
  }

  feedForward(inputs) {
    let weightedSum = super.feedForward(inputs);
    return this.leakReLU(weightedSum);
  }
}

class NeuralNet {
  constructor(inputNeuronAmount, layers, layerSize) {
    this.inputNeuronAmount = inputNeuronAmount;
    this.layers = layers;
    this.layerSize = layerSize;
    this.neurons = [];
    let prevLayerSize = inputNeuronAmount;
    for (let i = 0; i < layers; i++) {
      const layerNeurons = [];
      for (let j = 0; j < layerSize; j++) {
        const weights = Array.from({length: prevLayerSize}, () => Math.random() * 2 - 1);
        const bias = Math.random() * 2 - 1;
        layerNeurons.push(new HiddenLayerNeuron(weights, bias));
      }
      this.neurons.push(layerNeurons);
      prevLayerSize = layerSize;
    }
    const outputWeights = Array.from({length: prevLayerSize}, () => Math.random() * 2 - 1);
    const outputBias = Math.random() * 2 - 1;
    this.outputNeuron = new Neuron(outputWeights, outputBias);
  }

  feedForward(inputs) {
    let currentInputs = inputs;
    for (let i = 0; i < this.layers; i++) {
      const layerOutputs = [];
      for (let j = 0; j < this.layerSize; j++) {
        const neuron = this.neurons[i][j];
        const output = neuron.feedForward(currentInputs);
        layerOutputs.push(output);
      }
      currentInputs = layerOutputs;
    }
    return this.outputNeuron.feedForward(currentInputs);
  }

  save(filename) {
    const data = JSON.stringify(this);
    var a = document.getElementById("a2");
    a.href = window.URL.createObjectURL(new Blob([data], {type: "text/plain"}));
    a.download = filename;
    a.click(); 
  }

  load(file) {
    const reader = new FileReader();
    reader.addEventListener('load', (event) => {
      const parsedData = JSON.parse(event.target.result);
      this.copyfrom(parsedData);
      neuro_ui.refresh();
      trackmap_ui.changeSensorAmount(this.inputNeuronAmount);
    });
    reader.readAsText(file);
  }

  copyfrom(parsedData) {
    this.inputNeuronAmount = parsedData.inputNeuronAmount;
    this.layers = parsedData.layers;
    this.layerSize = parsedData.layerSize;
    this.neurons = [];
    for (let i = 0; i < this.layers; i++) {
      const layerNeurons = [];
      for (let j = 0; j < this.layerSize; j++) {
        const neuron = parsedData.neurons[i][j];
        layerNeurons.push(new HiddenLayerNeuron(neuron.weights, neuron.bias));
      }
      this.neurons.push(layerNeurons);
    }
    this.outputNeuron = new Neuron(parsedData.outputNeuron.weights, parsedData.outputNeuron.bias);
  }

  mutations(mutationRate) {
    for (let i = 0; i < this.layers; i++) {
      for (let j = 0; j < this.layerSize; j++) {
        const neuron = this.neurons[i][j];
        for (let k = 0; k < neuron.weights.length; k++) {
          neuron.weights[k] += (Math.random() * 2 - 1) * mutationRate;
        }
        neuron.bias += (Math.random() * 2 - 1) * mutationRate;
      }
    }
    for (let i = 0; i < this.outputNeuron.weights.length; i++) {
      this.outputNeuron.weights[i] += (Math.random() * 2 - 1) * mutationRate;
    }
    this.outputNeuron.bias += (Math.random() * 2 - 1) * mutationRate;
  }
}


class NeuralNetPainter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  paint(neuralNet) {
    // clear background
    this.ctx.fillStyle = "white";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const layer_height = this.canvas.height / (neuralNet.layers + 3);
    this.ctx.fillStyle = "green";
    this.ctx.font = "18px Arial";
    this.ctx.textAlign = "center";
    this.ctx.fillText("input: car sensors", this.canvas.width/2, layer_height/2);
    this.ctx.fillText("output: car steering", this.canvas.width/2, this.canvas.height - layer_height/2);

    let cnt_old = neuralNet.inputNeuronAmount;
    this._paintLayer(0, layer_height, 0, cnt_old);
    for (let i = 1; i <= neuralNet.layers; i++) {
      this._paintLayer(layer_height * i, layer_height * (i + 1), cnt_old, neuralNet.layerSize);
      cnt_old = neuralNet.layerSize;
    }
    this._paintLayer(layer_height * (neuralNet.layers + 1), layer_height * (neuralNet.layers + 2), cnt_old, 1);
  }

  _paintLayer(y1, y2, cnt1, cnt2) {
    const dx1 = this.canvas.width / (cnt1 + 1);
    const dx2 = this.canvas.width / (cnt2 + 1);
    for (let i = 1; i <= cnt2; i++) {
      this.ctx.strokeStyle = "navy";
      for (let j = 1; j <= cnt1; j++) {
        this.ctx.beginPath();
        this.ctx.moveTo(dx1 * j, y1);
        this.ctx.lineTo(dx2 * i, y2);
        this.ctx.stroke();
      }
      this.ctx.fillStyle = "navy";
      this.ctx.beginPath();
      const nodesize = 15;
      this.ctx.arc(dx2 * i, y2, nodesize, 0, 2 * Math.PI);
      this.ctx.fill();  
    }      

  }
}

class CarDriver {
  constructor(car, net, trackMap) {
    this.car = car;
    this.net = net;
    this.trackMap = trackMap;
  }

  drive() {
    if (this.car.inGoal || this.car.isCrash) return false;
    const sensors = this.car.readSensors(this.trackMap);
    const steeringOff = this.net.feedForward(sensors)*10;
    //console.log("CarDriver.steeringOffset:", steeringOff);
    this.car.steering += steeringOff;
    this.car.move();
    return true;
  }
}

class Training {
  constructor(trackmap_ui, neuro_ui) {
    this.trackmap_ui = trackmap_ui;
    this.neuro_ui = neuro_ui;
    this.isRunning = false;
    this.showTraining = false;
  }

  stop() {
    this.isRunning = false;
  }

  toggleShowTraining() {
    this.showTraining = !this.showTraining;
  }

  train() {
    this.isRunning = true;
    const population = 2000;      // TODO: configurable
    const maxage = 250;         // TODO: configurable
    const mutationRate = 0.1;   // TODO: configurable
    const car = this.trackmap_ui.car;
    const inputs = this.neuro_ui.net.inputNeuronAmount;
    const layers = this.neuro_ui.net.layers;
    const layerSize = this.neuro_ui.net.layerSize;
    let drivers = [];
    for (let i = 0; i < population; i++) {
      drivers.push(new CarDriver(Car.copy(car), new NeuralNet(inputs, layers, layerSize), this.trackmap_ui.trackMap));
    }
    let bestdriver = drivers[0];
    let bestfitness = -1000;
    let oldfittnes = 0;

    let age=0
    while (this.isRunning) {
      const alive = [];
      for (let driver of drivers) {
        if (driver.drive()) {
          alive.push(driver);
        } else {
          if (driver.car.inGoal) {
            console.log("done.");
            this.neuro_ui.net = driver.net;
            return;
          }
        }
      }
      if (alive.length > 0 ) drivers = alive;
      if (this.showTraining) { // TODO: only last state is shown, thus move into seperate thread for updating ui every 200 ms
        console.log("cars:",drivers.map(d => Math.round(d.car.position.x)+":"+Math.round(d.car.position.y)+":"+Math.round(d.car.steering)));
        this.trackmap_ui.refresh();
        for (let driver of drivers) this.trackmap_ui.carPainter.paint(driver.car);
      }
      if (++age == maxage) {
        age = 0;
        // find best driver
        for (let driver of drivers) {
          const fitness = this.getFittness(driver.car);
          if (fitness > bestfitness) {
            bestfitness = fitness;
            bestdriver = driver;
          }
        }
        console.log("current bestfitness: "+bestfitness);
        if (oldfittnes == bestfitness) {
          console.log("done.");
          this.neuro_ui.net = bestdriver.net;
          return;
        }
        oldfittnes = bestfitness;
        // fill new population based on best driver
        drivers = [];
        for (let i = 0; i < population; i++) {
          let net = new NeuralNet();
          net.copyfrom(bestdriver.net);
          net.mutations(mutationRate);
          drivers.push(new CarDriver(Car.copy(car), net, this.trackmap_ui.trackMap));
        }    
      }
    }
  }

  getFittness(car) {
    return -this.trackmap_ui.trackMap.distance2goal(car.position);
  }

}


// =========================== user interface controller

class NeuroUI {
  constructor(canvas, net, driver) {
    this.canvas = canvas;
    this.net = net;
    this.driver = driver;
    this.neuroPainter = new NeuralNetPainter(canvas);
    this.isDriving = false;
  }

  refresh() {
    this.neuroPainter.paint(this.net);
  }

  changeInputAmount(cnt) {
    this.net = new NeuralNet(parseInt(cnt), this.net.layers, this.net.layerSize);
    this.refresh();
  }

  changeLayerAmount(cnt) {
    this.net = new NeuralNet(this.net.inputNeuronAmount, parseInt(cnt), this.net.layerSize);
    this.refresh();
  }

  changeLayerSize(cnt) {
    this.net = new NeuralNet(this.net.inputNeuronAmount, this.net.layers, parseInt(cnt));
    this.refresh();
  }

  randomize() {
    this.net = new NeuralNet(this.net.inputNeuronAmount, this.net.layers, this.net.layerSize);
    this.refresh();
  }

  save(filename) {
    this.net.save(filename);
  }

  load(file) {
    this.net.load(file);    
  }

  drive(trackmap_ui) {
    const that = this;
    that.driver.net = this.net;
    that.isDriving = true;
    function update() {              
      if (that.isDriving && that.driver.drive()) {
        trackmap_ui.refresh();
        setTimeout(() => {  requestAnimationFrame(update); }, 50);
      }
    }
    update();
  }

  stop() {
    this.isDriving = false;
  }
}

class TrackMapUI {
  constructor(canvas, trackMap, car) {
    this.canvas = canvas;
    this.trackMap = trackMap;
    this.car = car;

    this.ctx = canvas.getContext("2d");
    this.trackMapPainter = new TrackMapPainter(canvas);
    this.carPainter = new CarPainter(canvas);
    this.isDrawing = false;
    this.wallStart = null;
  }

  refresh() {        
    const sensors = this.car.readSensors(this.trackMap);
    //console.log("Sensors:", sensors);
    this.trackMapPainter.paint(this.trackMap);
    this.carPainter.paint(this.car);
  }

  addEventListeners() {
    /**
     * Handles user key events Left, Right, Up and updates the car's steering and position accordingly.
     * @param {KeyboardEvent} event - The keydown event.
     */
    document.addEventListener("keydown", (event) => {
      //if (this.car.isCrash) return;
      switch(event.key) {
        case "ArrowLeft": this.car.steering -= 5; break;
        case "ArrowRight": this.car.steering += 5; break;
        case "ArrowUp": this.car.move(); break;
        case "ArrowDown": this.car.moveBack(); break;
      }
      this.refresh();
    });

    this.canvas.addEventListener("mousedown", (event) => {
        this.wallStart = this.canvasPoint(event);
        this.isDrawing = true;
      });
      
    this.canvas.addEventListener("mouseup", (event) => {
      if (!this.isDrawing) return;
      const wallEnd = this.canvasPoint(event);
      const wall = new Wall(this.wallStart.x, this.wallStart.y, wallEnd.x, wallEnd.y); // create a new wall
      this.trackMap.addWall(wall); // add the wall to the track map
      this.refresh();
      this.isDrawing = false;
    });
    
    this.canvas.addEventListener("mousemove", (event) => {
      if (!this.isDrawing) return;
      this.refresh();
      const wallEnd = this.canvasPoint(event);
      this.ctx.strokeStyle = "gray";
      this.ctx.beginPath();
      this.ctx.moveTo(this.wallStart.x, this.wallStart.y);
      this.ctx.lineTo(wallEnd.x, wallEnd.y);
      this.ctx.stroke();
    });    
  }
  
  canvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return new Point(x, y);
  }

  toggleShowSensors() {
    this.carPainter.showSensors = !this.carPainter.showSensors;
    this.refresh();
  }

  toggleShowWallDistances() {
    this.carPainter.showWallDistances = !this.carPainter.showWallDistances;
    this.refresh();
  }

  changeSensorAmount(sensorAmount) {
    this.car.sensors = Sensor.createSensors(50, parseInt(sensorAmount));
    this.refresh();
  }
}

// =========================== basic setup

const canvas = document.getElementById("canvas");
const trackMap = new TrackMap(canvas.width, canvas.height);
//trackMap.addRandomWalls(10);

const car_start_pos = new Point(canvas.width/10, canvas.height/10);
const car = new Car(car_start_pos, 0, 5, 2); // pos, steering, speed, #sensors

const trackmap_ui = new TrackMapUI(canvas, trackMap, car);
trackmap_ui.addEventListeners();
trackmap_ui.refresh();

const canvas2 = document.getElementById("canvas2");
const net = new NeuralNet(2,2,4);
const driver = new CarDriver(car, net, trackMap);
const neuro_ui = new NeuroUI(canvas2, net, driver);
neuro_ui.refresh();

const trainer = new Training(trackmap_ui, neuro_ui);

