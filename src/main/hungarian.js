/** Assignment solver shared by the trackers. */

// ------------------------------------------------------------- hungarian ----

/** Kevin Stern's O(n^3) Hungarian algorithm. Returns, per row, its column or -1. */
function hungarian(costMatrix) {
  const rows = costMatrix.length;
  const cols = costMatrix[0].length;
  const dim = Math.max(rows, cols);

  const cost = [];
  for (let w = 0; w < dim; w++) {
    const row = new Float64Array(dim);
    if (w < rows) {
      for (let j = 0; j < cols; j++) {
        const v = costMatrix[w][j];
        if (!Number.isFinite(v)) throw new Error('Non-finite cost in assignment matrix');
        row[j] = v;
      }
    }
    cost.push(row);
  }

  const labelByWorker = new Float64Array(dim);
  const labelByJob = new Float64Array(dim);
  const minSlackWorkerByJob = new Int32Array(dim);
  const minSlackValueByJob = new Float64Array(dim);
  const committedWorkers = new Array(dim).fill(false);
  const parentWorkerByCommittedJob = new Int32Array(dim);
  const matchJobByWorker = new Int32Array(dim).fill(-1);
  const matchWorkerByJob = new Int32Array(dim).fill(-1);

  const match = (w, j) => {
    matchJobByWorker[w] = j;
    matchWorkerByJob[j] = w;
  };

  // reduce
  for (let w = 0; w < dim; w++) {
    let min = Infinity;
    for (let j = 0; j < dim; j++) if (cost[w][j] < min) min = cost[w][j];
    for (let j = 0; j < dim; j++) cost[w][j] -= min;
  }
  const colMin = new Float64Array(dim).fill(Infinity);
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) if (cost[w][j] < colMin[j]) colMin[j] = cost[w][j];
  }
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) cost[w][j] -= colMin[j];
  }

  // initial feasible solution
  for (let j = 0; j < dim; j++) labelByJob[j] = Infinity;
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) if (cost[w][j] < labelByJob[j]) labelByJob[j] = cost[w][j];
  }

  // greedy match
  for (let w = 0; w < dim; w++) {
    for (let j = 0; j < dim; j++) {
      if (matchJobByWorker[w] === -1 && matchWorkerByJob[j] === -1 &&
          cost[w][j] - labelByWorker[w] - labelByJob[j] === 0) {
        match(w, j);
      }
    }
  }

  const fetchUnmatchedWorker = () => {
    let w = 0;
    for (; w < dim; w++) if (matchJobByWorker[w] === -1) break;
    return w;
  };

  const initializePhase = (w) => {
    committedWorkers.fill(false);
    parentWorkerByCommittedJob.fill(-1);
    committedWorkers[w] = true;
    for (let j = 0; j < dim; j++) {
      minSlackValueByJob[j] = cost[w][j] - labelByWorker[w] - labelByJob[j];
      minSlackWorkerByJob[j] = w;
    }
  };

  const updateLabeling = (slack) => {
    for (let w = 0; w < dim; w++) if (committedWorkers[w]) labelByWorker[w] += slack;
    for (let j = 0; j < dim; j++) {
      if (parentWorkerByCommittedJob[j] !== -1) labelByJob[j] -= slack;
      else minSlackValueByJob[j] -= slack;
    }
  };

  const executePhase = () => {
    for (;;) {
      let minSlackWorker = -1;
      let minSlackJob = -1;
      let minSlackValue = Infinity;
      for (let j = 0; j < dim; j++) {
        if (parentWorkerByCommittedJob[j] === -1 && minSlackValueByJob[j] < minSlackValue) {
          minSlackValue = minSlackValueByJob[j];
          minSlackWorker = minSlackWorkerByJob[j];
          minSlackJob = j;
        }
      }
      if (minSlackValue > 0) updateLabeling(minSlackValue);
      parentWorkerByCommittedJob[minSlackJob] = minSlackWorker;
      if (matchWorkerByJob[minSlackJob] === -1) {
        let committedJob = minSlackJob;
        let parentWorker = parentWorkerByCommittedJob[committedJob];
        for (;;) {
          const temp = matchJobByWorker[parentWorker];
          match(parentWorker, committedJob);
          committedJob = temp;
          if (committedJob === -1) break;
          parentWorker = parentWorkerByCommittedJob[committedJob];
        }
        return;
      }
      const worker = matchWorkerByJob[minSlackJob];
      committedWorkers[worker] = true;
      for (let j = 0; j < dim; j++) {
        if (parentWorkerByCommittedJob[j] === -1) {
          const slack = cost[worker][j] - labelByWorker[worker] - labelByJob[j];
          if (minSlackValueByJob[j] > slack) {
            minSlackValueByJob[j] = slack;
            minSlackWorkerByJob[j] = worker;
          }
        }
      }
    }
  };

  let w = fetchUnmatchedWorker();
  while (w < dim) {
    initializePhase(w);
    executePhase();
    w = fetchUnmatchedWorker();
  }

  const result = Array.from(matchJobByWorker.subarray(0, rows));
  for (let i = 0; i < result.length; i++) if (result[i] >= cols) result[i] = -1;
  return result;
}

module.exports = { hungarian };
