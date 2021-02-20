exports.createTaskState = createTaskState;

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { asyncLoader, asyncSaver, writeFileWithMkdir } = require('./util.js');

const MODE_SINGLE_FILE = 'single';
// TODO: Add a mode that saves each job as a single .json file, compare performance on a big build

function loadAll(ts, next) {
  if (ts.mode === MODE_SINGLE_FILE) {
    let disk_path = path.join(ts.dir, 'state.json');
    fs.readFile(disk_path, 'utf8', function (err, value) {
      ts.job_states = {}; // If error of any kind, reset to empty state
      if (err) {
        // Probably file doesn't exist, reset to blank state
        return next();
      }
      try {
        let data = JSON.parse(value);
        ts.job_states = data;
        next();
      } catch (e) {
        // Possibly previous build interrupted while writing state
        console.warn(`Error parsing JSON in ${disk_path} (resetting to blank state): ${e}`);
        next();
      }
    });
  } else {
    assert(!'TODO');
  }
}

function saveTaskState(ts, next) {
  let data = JSON.stringify(ts.job_states, undefined, 2); // TODO: optional formatting when not testing
  let disk_path = path.join(ts.dir, 'state.json');
  console.debug(`  Writing ${disk_path}...`);
  writeFileWithMkdir(disk_path, data, next);
}

const loader = asyncLoader(loadAll);
const taskSaver = asyncSaver(saveTaskState);

function TaskState(opts) {
  assert(opts.dir);
  this.mode = MODE_SINGLE_FILE;
  this.dir = opts.dir;
  // this.job_states = {};
}

TaskState.prototype.loadAll = function (next) {
  loader(this, next);
};

TaskState.prototype.getAllJobStates = function () {
  return this.job_states;
};

TaskState.prototype.getJobState = function (job_name) {
  return this.job_states[job_name];
};

TaskState.prototype.setJobState = function (job_name, state, next) {
  this.job_states[job_name] = state;
  if (this.mode === MODE_SINGLE_FILE) {
    taskSaver(this, next);
  } else {
    assert(!'TODO');
  }
};

function createTaskState(opts) {
  return new TaskState(opts);
}