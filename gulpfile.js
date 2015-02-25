var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var browserSync = require('browser-sync');
var argv = require('yargs').argv;
var gutil = require('gulp-util');
var del = require('del');
var runSequence = require('run-sequence');
var sortObject = require('sort-object');
var fs = require('fs');
var path = require('path');
var merge = require('merge-stream');

var metalsmith = require('metalsmith');
var templates = require('metalsmith-templates');
var ignore = require('metalsmith-ignore');
var layouts = require('metalsmith-layouts');
var assets = require('metalsmith-assets');
var collections = require('metalsmith-collections');
var markdown = require('metalsmith-markdown');
var branch = require('metalsmith-branch');
var permalinks = require('metalsmith-permalinks');
var metalsmithDebug = require('metalsmith-debug');
var paginate = require('metalsmith-paginate');
var feed = require('metalsmith-feed');
var redirect = require('metalsmith-redirect');
var draft = require('metalsmith-drafts');

//--

var lang = argv.lang === 'en' ? 'en' : 'ja';

var aws;
try {
  aws = JSON.parse(fs.readFileSync(path.join(__dirname, 'aws_' + lang + '.json')));
} catch(e) {
}

//////////////////////////////
// generate
//////////////////////////////
gulp.task('generate', ['less', 'metalsmith', 'blog']);

gulp.task('blog', function(done) {

  if (lang === 'ja') {
    done();
    return;
  }

  metalsmith(__dirname)
    .clean(false)
    .source('./blog/posts/')
    .destination('./out_en/blog/')
    .metadata(require('./config.js')('en'))
    .use(draft())
    .use(require('./plugins/helpers')())
    .use(collections({
      articles: {
        pattern: '*.markdown',
        soryBy: 'date',
        reverse: true
      }
    }))
    .use(branch('*.markdown')
      // articles 
      .use(markdown({
        gfm: true,
        tables: true,
        breaks: false,
        pedantic: false,
        sanitize: false,
        smartLists: true,
        smartypants: true
      }))
      .use(permalinks({
        pattern: ':id'
      }))
      .use(function(files, metalsmith, done) {
        var authors = metalsmith.metadata().env.authors;
        for (var path in files) {
          var doc = files[path];
          var authorName = doc.author;

          if (!doc.author) {
            throw new Error('@author is undefined: ' + path);
          }

          doc.isArticle = true;
          doc.author = authors[doc.author];

          if (!doc.author) {
            throw new Error('no such author: ' + authorName);
          }
        }

        done();
      })
    )
    .use(branch('*.html')
      // index page
      .use(paginate({
        perPage: 10,
        path: 'blog'
      }))
      .use(function(files, metalsmith, done) {
        metalsmith.metadata().getPath = function(file) {
          file = file || this;
          for (var path in files) {
            if (file === files[path]) {
              return path;
            }
          }
          return '???';
        };
        done();
      })
      .use(templates({inPlace: true, engine: 'eco'}))
    )
    .use(metalsmithDebug())
    .use(feed({
      collection: 'articles',
      limit: 10,
      destination: 'rss.xml',
      feedOptions: {
        title: 'Onsen UI Blog',
        url: 'http://onsen.io/blog'
      }
    }))
    .use(branch('!rss.xml')
      .use(layouts({
        engine: 'eco',
        directory: './src/layouts/',
        default: 'blog.html.eco'
      }))
    )
    .use(assets({
      source: './blog/content',
      destination: './content'
    }))
    .build(function(error) {
      if (error) {
        gutil.log('ERROR: ' + error);
      }
      done();
    });

});

//////////////////////////////
// metalsmith
//////////////////////////////
gulp.task('metalsmith', function(done) {

  metalsmith(__dirname)
    .clean(false)
    .source('./src/documents_' + lang)
    .metadata(require('./config.js')(lang))
    .use(draft())
    .use(require('./plugins/helpers')())
    .use(require('./plugins/import-api-docs')(lang))
    .use(require('./plugins/patterns-collection')(lang))
    .use(collections({
      components: {
        sortBy: 'name'
      },
      objects: {
        soryBy: 'name'
      },
      guides: {
        soryBy: 'name'
      }
    }))
    .use(function(files, metalsmith, done) {
      var dict = {};
      for (var path in files) {
        var file = files[path];
        if (file.componentCategory) {
          file.componentCategory.split(/, */).forEach(function(category) {
            if (!dict[category]) {
              dict[category] = [];
            }
            dict[category].push(file);
          });
        }
      }
      metalsmith.metadata().componentCategoryDict = sortObject(dict);

      done();
    })
    .use(templates({engine: 'eco', inPlace: true}))
    .use(require('./plugins/autotoc')())
    .use(function(files, metalsmith, done) {
      var cssFile = files['reference/css.html'];
      var cssToc = cssFile.toc;
      delete cssFile.toc;
      metalsmith.metadata().cssToc = cssToc;
      done();
    })
    .use(layouts({engine: 'eco', directory: './src/layouts/', default: 'default.html.eco'}))
    .use(assets({source: './src/files'}))
    .use(require('./plugins/css-transform')(lang))
    .use(redirect({
      '/components.html' : '/reference/javascript.html',
      '/guide/components.html' : '/reference/javascript.html'
    }))
    .destination('./out_' + lang)
    .build(function(error) {
      if (error) {
        gutil.log('ERROR: ' + error);
        if (error.stack) {
          gutil.log(error.stack);
        }
      }

      browserSync.reload();
      gutil.log('Generated into \'./out_' + lang + '\'');
      done();
    });
});

//////////////////////////////
// less
//////////////////////////////
gulp.task('less', function() {
  return gulp.src('src/less/style.less')
    .pipe($.plumber())
    .pipe($.less())
    .pipe($.autoprefixer({
      browsers: ['last 2 versions'],
      cascade: false
    }))
    .pipe(gulp.dest('./out_' + lang + '/css/'));
});

//////////////////////////////
// clean
//////////////////////////////
gulp.task('clean', function(done) {
  del([
    'out_' + lang + '/*',
    '!out_' + lang + '/OnsenUI',
  ], done);
});

//////////////////////////////
// serve
//////////////////////////////
gulp.task('serve', ['generate'], function() {
  browserSync({
    server: {
      baseDir: 'out_' + lang,
      index: 'index.html'
    },
    notify: false,
    open: false,
    injectChanges: true
  });

  var options = {
    debounceDelay: 400
  };

  gulp.watch([
    'src/documents_' + lang + '/**/*',
    'OnsenUI/build/docs/' + lang + '/partials/*/*.html',
    'src/layouts/*',
    'src/partials/*',
    'src/files/**/*',
  ], options, function() {
    runSequence(['metalsmith', 'blog'], function() {
      browserSync.reload();
    });
  });

  gulp.watch([
    'src/less/*'
  ], options, function() {
    runSequence('less', function() {
      browserSync.reload();
    });
  });

  if (lang === 'en') {
    gulp.watch([
      'blog/*',
      'blog/posts/*',
      'blog/content/**/*',
      'src/layouts/blog.html.eco'
    ], options, function() {
      runSequence('blog', function() {
        browserSync.reload();
      });
    });
  }
});

//////////////////////////////
// deploy
//////////////////////////////
gulp.task('deploy', ['clean', 'generate'], function() {
  if (!aws) {
    throw new Error('aws_' + lang + '.json missing! Please create it before trying to deploy!');
  }

  var dst = 'out_' + lang;
  var publisher = $.awspublish.create(aws);

  var site = gulp.src([dst + '/**', '!' + dst + '/OnsenUI']);

  var templates = gulp.src('OnsenUI/project_templates/**')
    .pipe($.rename(function(path) {
      path.dirname = 'OnsenUI/project_templates/' + path.dirname;
    }));

  var build = gulp.src('OnsenUI/build/**')
    .pipe($.rename(function(path) {
      path.dirname = 'OnsenUI/build/' + path.dirname;
    }));

  return merge(site, templates, build)
    .pipe(publisher.publish())
    .pipe(publisher.sync())
    .pipe($.awspublish.reporter());

});

gutil.log('Language: --lang=' + lang);
gutil.log('Source: \'./src/documents_' + lang + '\'');
gutil.log('Destination: \'./out_' + lang + '\'');
