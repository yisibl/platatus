import browserify from 'browserify';
import babelify from 'babelify';
import fs from 'fs';
import path from 'path';
import del from 'del';
import source from 'vinyl-source-stream';
import buffer from 'vinyl-buffer';
import gulp from 'gulp';
import debounce from 'lodash.debounce';
import oghliner from 'oghliner';
import loadPlugins from 'gulp-load-plugins';
const plugins = loadPlugins({
  lazy: false,
});
import cssnext from 'postcss-cssnext';
import cssImport from 'postcss-import';
import cssNested from 'postcss-nested';
import cssExtend from 'postcss-simple-extend';
import cssSimpleVars from 'postcss-simple-vars';
import cssMqpacker from 'css-mqpacker';
import mkdirp from 'mkdirp';

import babelRegister from 'babel-core/register';
babelRegister();
import sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

const develop = process.env.NODE_ENV !== 'production';
console.log(`Building for ${develop ? 'development' : 'production'}`);

const distDir = './dist';
const publicDir = path.join(distDir, 'public');
const cacheDir = path.join(distDir, 'cache');

const workerFilename = 'offline-worker.js';
const workerPath = path.join(publicDir, workerFilename);

const indexHtmlFilename = 'index.html';
const indexHtmlPath = path.join(publicDir, indexHtmlFilename);

const statusFilepath = path.join(publicDir, 'status.json');

import engine from './engine/index.js';

gulp.task('clean', () => {
  return del([distDir]);
});

gulp.task('lint', () => {
  return gulp
    .src(['./*.js', './engine/*.js', './src/*.js', './tests/**/*.js'])
    .pipe(plugins.eslint())
    .pipe(plugins.eslint.format())
    .pipe(plugins.eslint.failOnError());
});

gulp.task('build:status', () => {
  mkdirp.sync(cacheDir);
  const options = {
    cacheDir: cacheDir,
  };
  return engine.buildStatus(options).then((status) => {
    fs.writeFileSync(statusFilepath, JSON.stringify(status, null, 2));
  });
});

gulp.task('build:index', ['build:status'], () => {
  const status = JSON.parse(fs.readFileSync(statusFilepath));
  return engine.buildIndex(status).then((contents) => {
    fs.writeFileSync(indexHtmlPath, contents);
  });
});

gulp.task('build:html', ['build:index', 'build:css'], () => {
  gulp
    .src(path.join(publicDir, '*.html'))
    // TODO: Uncomment when compression works
    // .pipe(plugins.if(!develop, plugins.inlineSource({
    //   compress: false,
    // })))
    .pipe(plugins.if(!develop, plugins.minifyHtml()))
    .pipe(gulp.dest(publicDir));
});

gulp.task('build:tabzilla', () => {
  return gulp
    .src(['./node_modules/mozilla-tabzilla/media/img/*.png'])
    .pipe(gulp.dest(path.join(publicDir, 'images')));
});

gulp.task('build:root', () => {
  return gulp
    .src(
      ['./src/*.*', './src/fonts/*.*', './src/images/**/*.*'],
      {base: './src'}
    )
    .pipe(gulp.dest(publicDir));
});

gulp.task('build:js', () => {
  return browserify({
    entries: './src/js/index.js',
    debug: true,
  })
  .transform(babelify.configure())
  .bundle()
  .pipe(source('bundle.js'))
  .pipe(buffer())
  .pipe(plugins.sourcemaps.init({
    loadMaps: true,
  }))
  .pipe(plugins.if(!develop, plugins.uglify()))
  .pipe(plugins.sourcemaps.write('.'))
  .pipe(gulp.dest(publicDir));
});

gulp.task('build:css', () => {
  const processors = [
    cssImport(),
    cssExtend(),
    cssNested(),
    cssSimpleVars(),
    cssMqpacker(),
    cssnext({
      browers: ['last 1 version'],
      compress: true,
      messages: {
        console: true,
      },
    }),
  ];
  return gulp
    .src('./src/css/index.css')
    .pipe(plugins.sourcemaps.init())
    .pipe(plugins.postcss(processors))
    .pipe(plugins.concat('bundle.css'))
    .pipe(plugins.replace('../media/img/', 'images/'))
    .pipe(plugins.sourcemaps.write('.'))
    .pipe(gulp.dest(publicDir));
});

gulp.task('build:dist', ['build:root', 'build:tabzilla', 'build:status', 'build:html', 'build:js', 'build:css']);

function offline() {
  return oghliner.offline({
    rootDir: publicDir,
    fileGlobs: [
      indexHtmlFilename,
      'bundle.js',
      'bundle.css',
      'images/**/*.*',
    ],
  });
}

gulp.task('build', ['build:dist'], offline);

gulp.task('watch', ['build'], () => {
  const browserSyncCreator = require('browser-sync');
  const browserSync = browserSyncCreator.create();
  browserSync.init({
    open: false,
    server: {
      baseDir: publicDir,
      ghostMode: false,
      notify: false,
    },
  });
  gulp.watch(['./src/*.*'], ['./src/fonts/*.*', './src/images/**/*.*'], ['build:root']);
  gulp.watch(['./src/css/**/*.css'], ['build:css']);
  gulp.watch(['./src/js/*.js'], ['build:js']);
  gulp.watch(['./engine/*.js', './features/*.md', './src/tpl/*.html'], ['build:html']);
  gulp.watch([
    path.join(publicDir, '**/*.*'),
    '!' + workerPath,
    '!' + path.join(cacheDir, '*.json'),
  ], debounce(offline, 200));
  gulp.watch([workerPath], browserSync.reload);
});

gulp.task('default', ['build']);
