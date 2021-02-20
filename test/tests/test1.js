const assert = require('assert');
const async = require('async');
// const gb = require('glovjs-build');
const gb = require('../../');
const path = require('path');

const targets = {
  dev: path.join(__dirname, '../out/test1/dev'),
};

gb.configure({
  source: path.join(__dirname, '../data'),
  statedir: path.join(__dirname, '../out/test1/.gbstate'),
  targets,
});

function copy(job, done) {
  job.out(job.getFile());
  done();
}

function reverse(job, done) {
  let file = job.getFile();
  let buffer = Buffer.from(file.contents);
  for (let ii = 0; ii < buffer.length / 2; ++ii) {
    let t = buffer[ii];
    buffer[ii] = buffer[buffer.length - 1 - ii];
    buffer[buffer.length - 1 - ii] = t;
  }
  job.out({
    path: file.path,
    contents: buffer,
  });
  done();
}

function concatSimple(opts) {
  return function (job, done) {
    let files = job.getFiles();
    let buffer = Buffer.concat(files.map((f) => f.contents));
    job.out({
      path: opts.output,
      contents: buffer,
    });
    done();
  };
}

function cmpName(a, b) {
  return a.path < b.path ? -1 : 1;
}

function concatCachedInternal(opts, job, done) {
  let updated_files = job.getFilesUpdated();
  let deleted_files = job.getFilesDeleted();
  let user_data = job.getUserData();
  user_data.files = user_data.files || {};
  for (let ii = 0; ii < deleted_files.length; ++ii) {
    delete user_data.files[deleted_files[ii].path];
  }

  for (let ii = 0; ii < updated_files.length; ++ii) {
    let f = updated_files[ii];
    if (opts.skip === f.path) {
      continue;
    }
    user_data.files[f.path] = f;
  }
  let files = Object.values(user_data.files).sort(cmpName);

  // Note: above is equivalent to `let files = job.getFiles()`, since we're not actually caching anything

  let buffer = Buffer.concat(files.map((f) => f.contents));
  job.out({
    path: opts.output,
    contents: buffer,
  });
  done();
}

function concatCached(opts) {
  return concatCachedInternal.bind(null, opts);
}

function atlas(job, done) {
  let input = job.getFile();
  let input_data;
  if (input.isUpdated()) {
    job.depReset();

    try {
      input_data = JSON.parse(input.contents);
    } catch (e) {
      return done(`Error parsing ${input.path}: ${e}`);
    }

    let { output, inputs } = input_data;
    if (!output) {
      return done('Missing `output` field');
    }
    if (!inputs || !inputs.length) {
      return done('Missing or empty `inputs` field');
    }
    job.getUserData().atlas_data = input_data;

    async.each(inputs, (name, next) => {
      job.depAdd(name, next);
    }, (err) => {
      if (err) {
        return done(err);
      }
      concatCachedInternal({ output: input_data.output, skip: input.path }, job, done);
    });
  } else {
    // only a dep has changed
    input_data = job.getUserData().atlas_data;

    // input did not change, no changes which files we depend on
    concatCachedInternal({ output: input_data.output }, job, done);
  }
}

function warnOn(file) {
  return function (job, done) {
    if (job.getFile().path === file) {
      job.warn(`(expected warning on ${file})`);
    }
    done();
  };
}

function errorOn(file) {
  return function (job, done) {
    if (job.getFile().path === file) {
      // done(err) should also do the same
      job.error(`(expected error on ${file})`);
    }
    done();
  };
}

gb.task({
  name: 'copy',
  input: 'txt/*.txt',
  type: gb.SINGLE,
  target: 'dev',
  func: copy,
});

gb.task({
  name: 'concat',
  input: [
    'txt/*.txt',
    'txt/*.asc',
  ],
  type: gb.ALL,
  target: 'dev',
  func: concatSimple({ output: 'concat.txt' }),
});

gb.task({
  name: 'reverse',
  input: 'txt/*.txt',
  type: gb.SINGLE,
  func: reverse,
});

gb.task({
  name: 'concat-reverse',
  input: 'reverse:**',
  type: gb.ALL,
  target: 'dev',
  func: concatCached({ output: 'concat-reverse.txt' }),
});

gb.task({
  name: 'atlas',
  input: 'atlas/*.json',
  type: gb.SINGLE,
  target: 'dev',
  func: atlas,
});

gb.task({
  name: 'warns',
  input: 'txt/*.txt',
  type: gb.SINGLE,
  func: warnOn('txt/file2.txt'),
});

let did_run = false;
gb.task({
  name: 'does_run',
  input: 'txt/*.txt',
  type: gb.ALL,
  func: (job, done) => {
    did_run = true;
    done();
  },
  deps: ['warns'],
});

gb.task({
  name: 'errors',
  input: 'txt/*.txt',
  type: gb.SINGLE,
  func: errorOn('txt/file1.txt'),
});

gb.task({
  name: 'never_runs',
  input: 'txt/*.txt',
  type: gb.SINGLE,
  func: () => assert(false),
  deps: ['errors'],
});


gb.task({
  name: 'default',
  deps: ['concat', 'copy', 'concat-reverse', 'atlas', 'never_runs', 'does_run'],
});

gb.go(['default']);

gb.once('done', function (err) {
  const fs = require('fs'); // eslint-disable-line global-require
  console.log('Build complete! Checking...');
  function check(target, file, contents) {
    assert.equal(fs.readFileSync(path.join(targets[target], file), 'utf8'), contents);
  }
  if (err) {
    assert(process.exitCode);
    process.exitCode = 0;
  }
  assert(did_run);
  check('dev', 'concat.txt', 'ascii1file1file2');
  check('dev', 'concat-reverse.txt', '1elif2elif');
  check('dev', 'my_atlas.txt', 'file1file2');
  check('dev', 'txt/file1.txt', 'file1');
  check('dev', 'txt/file2.txt', 'file2');
  // TODO: Better checking that checks for an orphans removed, etc
  // TODO: encapsulate source files into this test so it writes a clean set of files, runs build, checks results
});
