const fs = require("fs");
const path = require("path");
const markdownIt = require("markdown-it");
const iterator = require("markdown-it-for-inline");
const { format } = require("date-fns");
const CleanCSS = require("clean-css");
const { minify } = require("terser");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const pluginPWA = require("eleventy-plugin-pwa");
const feather = require("feather-icons");

if (!String.prototype.endsWith) {
  String.prototype.endsWith = function (search, this_len) {
    if (this_len === undefined || this_len > this.length) {
      this_len = this.length;
    }
    return this.substring(this_len - search.length, this_len) === search;
  };
}

const closestFile = (fileName, arrayOfPaths) => {
  arrayOfPaths.forEach((path) => {
    console.log(fileName, path);
  });
  return arrayOfPaths[0];
};

function replaceAttr(token, attrName, replace, env) {
  token.attrs.forEach(function (attr) {
    if (attr[0] === attrName) {
      attr[1] = replace(attr[1], env, token);
    }
  });
}

const buildFileTree = (dir) => {
  const build = (currentDir) => {
    let results = {};
    const list = fs.readdirSync(currentDir);
    list.forEach((file) => {
      const resolved = path.resolve(currentDir, file);
      const pathArray = resolved.split("/");
      const fileName = pathArray[pathArray.length - 1];
      const stat = fs.statSync(resolved);
      if (stat && stat.isDirectory()) {
        results = { ...results, ...build(resolved) };
      } else if (fileName.endsWith(".md")) {
        if (!results[fileName.replace(".md", "")]) {
          results[fileName.replace(".md", "")] = [];
        }
        results[fileName.replace(".md", "")].push(path.relative(dir, resolved));
      }
    });
    return results;
  };

  const results = build(dir);
  const findClosest = (fileName) => {
    if (!results[fileName]) {
      return fileName;
    } else if (results[fileName].length === 1) {
      return results[fileName][0];
    } else {
      return closestFile(fileName, results[fileName]);
    }
  };
  return findClosest;
};

module.exports = function (eleventyConfig) {
  const markdownItOptions = {
    html: true,
    linkify: true,
  };

  const findClosest = buildFileTree("./vault");

  eleventyConfig.addFilter("prettyDate", (value) =>
    format(new Date(value), "yyyy-MM-dd")
  );

  const md = markdownIt(markdownItOptions)
    .use(require("markdown-it-footnote"))
    .use(require("markdown-it-attrs"))
    .use(require("markdown-it-checkbox"))
    // .use(require('markdown-it-task-lists'))
    .use(function (md) {
      // Recognize Obsidian attachment links
      md.linkify.add("![[", {
        validate: /^([\w\s/-]+)(.\w+)?\s?(\|\s?([\w\s/]+))?\]\]/,
        normalize: (match) => {
          const parts = match.raw.slice(3, -2).split("|");
          match.text = (parts[1] || parts[0]).trim();
          const fileName = parts[0].trim();
          match.url = `/attachments/${fileName}`;
        },
      });
      // Recognize Mediawiki links ([[text]])
      md.linkify.add("[[", {
        validate: /^([\w\s/-]+)(.\w+)?\s?(\|\s?([\w\s/]+))?\]\]/,
        normalize: (match) => {
          const parts = match.raw.slice(2, -2).split("|");
          parts[0] = parts[0].replace(/.(md|markdown)\s?$/i, "");
          match.text = (parts[1] || parts[0]).trim();
          const fileName = parts[0].trim();
          const file = findClosest(fileName).replace(".md", "");
          match.url = `/${file}`;
        },
      });
    })
    .use(function (md, config) {
      // handle attachment links
      const defaultRender =
        md.renderer.rules.link_open ||
        function (tokens, idx, options, env, self) {
          return self.renderToken(tokens, idx, options);
        };

      md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        var token = tokens[idx],
          aIndex = token.attrIndex("href");
        /*
          Don't do anything if the link isn't in the attachments folder or isn't a local link
        */
        if (
          !token.attrs[aIndex][1].includes("http") &&
          !token.attrs[aIndex][1].includes("/attachments")
        ) {
          return defaultRender(tokens, idx, options, env, self);
        }

        // image attachments
        if (/\.(png|gif|jpg)/.test(token.attrs[aIndex][1])) {
          const href = token.attrs[aIndex][1];
          return `
            <img src="${href}" width="100%" />
            `;
        }

        // pass token to default renderer.
        return defaultRender(tokens, idx, options, env, self);
      };
    });

  eleventyConfig.addFilter("markdownify", (string) => {
    return md.render(string);
  });

  eleventyConfig.addFilter("iconify", (icon) => {
    return feather.icons[icon]?.toSvg({ class: "icon" });
  });

  eleventyConfig.setLibrary("md", md);

  eleventyConfig.addCollection("notes", function (collection) {
    return collection.getFilteredByGlob(["./vault/notes/**/*.md"]);
  });

  eleventyConfig.addPassthroughCopy("./vault/attachments");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy({
    "assets/manifest.json": "/manifest.json",
  });

  eleventyConfig.addFilter("cssmin", function (code) {
    return new CleanCSS({}).minify(code).styles;
  });

  eleventyConfig.addNunjucksAsyncFilter(
    "jsmin",
    async function (code, callback) {
      try {
        const minified = await minify(code);
        callback(null, minified.code);
      } catch (err) {
        console.error("Terser error: ", err);
        // Fail gracefully.
        callback(null, code);
      }
    }
  );

  eleventyConfig.addPlugin(pluginRss);

  eleventyConfig.addPlugin(pluginPWA);

  return {
    dir: {
      input: "./vault",
      output: "./_site",
      layouts: "../_layouts",
      includes: "../_includes",
      data: "../_data",
    },
    passthroughFileCopy: true,
  };
};
