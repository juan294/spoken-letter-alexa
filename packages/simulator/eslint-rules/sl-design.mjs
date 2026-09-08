// Design-system ESLint guards for the simulator (sl-design/*), modelled on the private
// repository's src/lib/eslint-rules/sl-design.mjs. Three rules keep components on the
// token variables projected by src/styles/theme.css:
//
//   1. no-hex-in-style        - hex or rgb()/rgba()/oklch() in style objects (inline JSX
//                                style props, hoisted CSSProperties consts, objects later
//                                passed as style={x}), template literals used as style
//                                values, and static raw <style> tags. Stylesheets are
//                                checked by src/styles/theme.test.ts instead.
//   2. no-literal-font-family - literal Newsreader / Mulish / mono stack names.
//   3. no-micro-font-size     - numeric or px/rem/em string fontSize under 11px.
//
// The MoonPixels illustration palette (MOON_PALETTE and FALLBACK_PIXEL_COLOR in
// src/brand/MoonPixels.tsx) is the one sanctioned literal-colour exception. It needs no
// disable comment: these rules inspect style-shaped objects, style props and <style>
// tags only, and the palette is a plain lookup table whose values reach the DOM through
// a variable (`background: color`), never as a literal in a style object.

export const COLOR_VALUED_PROPERTIES = new Set([
  "color",
  "backgroundColor",
  "background",
  "backgroundImage",
  "border",
  "borderTop",
  "borderBottom",
  "borderLeft",
  "borderRight",
  "borderColor",
  "borderTopColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderRightColor",
  "outline",
  "outlineColor",
  "boxShadow",
  "textShadow",
  "fill",
  "stroke",
  "textDecorationColor",
  "caretColor",
  "accentColor",
  "WebkitTextFillColor",
]);

const STYLE_SHAPE_PROPERTIES = new Set([
  ...COLOR_VALUED_PROPERTIES,
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textAlign",
  "whiteSpace",
  "borderRadius",
  "borderWidth",
  "padding",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "transition",
  "transform",
  "objectFit",
  "boxSizing",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gridTemplateColumns",
  "gridTemplateRows",
  "inset",
  "position",
  "display",
  "width",
  "height",
]);

const kebab = (value) => value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
const RAW_STYLE_COLOR_PROPERTIES = new Set([...COLOR_VALUED_PROPERTIES].map(kebab));

// Longest alternatives first; the lookahead keeps an over-long hex run from matching a shorter form.
const HEX_ANYWHERE_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/;
const CSS_COLOR_FUNCTION_RE = /\b(?:rgb|rgba|oklch)\s*\(/i;

/** The smallest sanctioned step is --text-micro (11px). */
export const MIN_FONT_SIZE_PX = 11;

function fontFamilyTokenFor(value) {
  const trimmed = value.trim();
  if (/\bNewsreader\b/.test(trimmed)) return "var(--font-heading)";
  if (/\bMulish\b/.test(trimmed)) return "var(--font-sans)";
  if (/\bui-monospace\b/.test(trimmed) || /\bSF Mono\b/.test(trimmed) || /\bMenlo\b/.test(trimmed) || trimmed === "monospace") {
    return "var(--font-mono)";
  }
  return null;
}

/** Numbers are px; `Npx`, `Nrem`, `Nem` strings convert (16px root). Anything else is out of scope. */
function fontSizeLiteralToPx(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const match = /^\s*(\d+(?:\.\d+)?)(px|rem|em)\s*$/.exec(value);
  if (!match) return null;
  return match[2] === "px" ? Number(match[1]) : Number(match[1]) * 16;
}

function isInsideJsxStyleProp(node) {
  let current = node.parent;
  while (current) {
    if (current.type === "JSXAttribute" && current.name?.name === "style") return true;
    current = current.parent;
  }
  return false;
}

function staticKeyName(key) {
  if (!key) return undefined;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

function objectLooksLikeStyle(objectExpression) {
  const properties = objectExpression.properties.filter((p) => p.type === "Property");
  if (properties.length === 0) return false;
  const styleKeys = properties.filter((p) => STYLE_SHAPE_PROPERTIES.has(staticKeyName(p.key))).length;
  return styleKeys >= 2 && styleKeys / properties.length >= 0.5;
}

/** Collects every object literal and decides at Program:exit which ones are styles. */
function createStyleObjectTracker(context) {
  const styleVariableNames = new Set();
  const objectExpressions = [];

  function isStyleLikeObject(node) {
    if (isInsideJsxStyleProp(node)) return true;
    const declarator = node.parent?.type === "VariableDeclarator" && node.parent.init === node ? node.parent : null;
    if (declarator) {
      const annotation = declarator.id?.typeAnnotation;
      if (annotation && /CSSProperties/.test(context.sourceCode.getText(annotation))) return true;
      if (declarator.id.type === "Identifier" && styleVariableNames.has(declarator.id.name)) return true;
    }
    return objectLooksLikeStyle(node);
  }

  return {
    visitors: {
      ObjectExpression(node) {
        objectExpressions.push(node);
      },
      "JSXAttribute[name.name='style'] > JSXExpressionContainer > Identifier"(node) {
        styleVariableNames.add(node.name);
      },
    },
    getStyleLikeObjects: () => objectExpressions.filter(isStyleLikeObject),
  };
}

function forEachStaticProperty(objectExpression, visit) {
  for (const property of objectExpression.properties) {
    if (property.type !== "Property") continue;
    const name = staticKeyName(property.key);
    if (name) visit(property, name);
  }
}

/** String literal text, or the static chunks of a template literal joined (expressions dropped). */
function staticText(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" ");
  return null;
}

function staticStyleElementText(node) {
  const name = node.openingElement?.name;
  if (!name || name.type !== "JSXIdentifier" || name.name !== "style") return null;
  let text = "";
  for (const child of node.children) {
    if (child.type === "JSXText") {
      text += child.value;
      continue;
    }
    if (child.type !== "JSXExpressionContainer") return null;
    const value = staticText(child.expression);
    if (value === null) return null;
    text += value;
  }
  return text.trim() ? text : null;
}

function hasLiteralColor(text) {
  return HEX_ANYWHERE_RE.test(text) || CSS_COLOR_FUNCTION_RE.test(text);
}

function rawStyleHasLiteralColor(cssText) {
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of stripped.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
    if (RAW_STYLE_COLOR_PROPERTIES.has(match[1].toLowerCase()) && hasLiteralColor(match[2])) return true;
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noHexInStyle = {
  meta: {
    type: "suggestion",
    messages: {
      hexInStyle:
        "Avoid hardcoded colours (hex, rgb(), rgba(), oklch()) in style objects, template style values or raw <style> tags. " +
        "Use a theme variable such as var(--evening-ink); derive tints with color-mix(). " +
        "The MoonPixels illustration palette is the only sanctioned exception.",
    },
    schema: [],
  },
  create(context) {
    const tracker = createStyleObjectTracker(context);
    return {
      ...tracker.visitors,
      JSXElement(node) {
        const cssText = staticStyleElementText(node);
        if (cssText && rawStyleHasLiteralColor(cssText)) context.report({ node: node.openingElement, messageId: "hexInStyle" });
      },
      "Program:exit"() {
        for (const objectExpression of tracker.getStyleLikeObjects()) {
          forEachStaticProperty(objectExpression, (property, name) => {
            if (!COLOR_VALUED_PROPERTIES.has(name)) return;
            const text = staticText(property.value);
            if (text !== null && hasLiteralColor(text)) context.report({ node: property.value, messageId: "hexInStyle" });
          });
        }
      },
    };
  },
};

/** @type {import("eslint").Rule.RuleModule} */
export const noLiteralFontFamily = {
  meta: {
    type: "suggestion",
    messages: {
      literalFont:
        "Avoid the literal font name '{{name}}'; it resolves to a local install or a generic fallback. Use {{replacement}}.",
    },
    schema: [],
  },
  create(context) {
    const tracker = createStyleObjectTracker(context);
    const report = (node, raw) => {
      const replacement = fontFamilyTokenFor(raw);
      if (replacement) context.report({ node, messageId: "literalFont", data: { name: raw.trim(), replacement } });
    };
    return {
      ...tracker.visitors,
      "JSXAttribute[name.name='fontFamily']"(node) {
        if (node.value?.type === "Literal" && typeof node.value.value === "string") report(node.value, node.value.value);
      },
      "Program:exit"() {
        for (const objectExpression of tracker.getStyleLikeObjects()) {
          forEachStaticProperty(objectExpression, (property, name) => {
            if (name !== "fontFamily") return;
            const text = staticText(property.value);
            if (text !== null) report(property.value, text);
          });
        }
      },
    };
  },
};

/** @type {import("eslint").Rule.RuleModule} */
export const noMicroFontSize = {
  meta: {
    type: "suggestion",
    messages: {
      microFontSize:
        "fontSize {{value}} is below the smallest type step (--text-micro, 11px). Use a var(--text-*) token.",
    },
    schema: [],
  },
  create(context) {
    const tracker = createStyleObjectTracker(context);
    return {
      ...tracker.visitors,
      "Program:exit"() {
        for (const objectExpression of tracker.getStyleLikeObjects()) {
          forEachStaticProperty(objectExpression, (property, name) => {
            if (name !== "fontSize" || property.value.type !== "Literal") return;
            const px = fontSizeLiteralToPx(property.value.value);
            if (px === null || px >= MIN_FONT_SIZE_PX) return;
            context.report({ node: property.value, messageId: "microFontSize", data: { value: String(property.value.value) } });
          });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "sl-design", version: "1.0.0" },
  rules: {
    "no-hex-in-style": noHexInStyle,
    "no-literal-font-family": noLiteralFontFamily,
    "no-micro-font-size": noMicroFontSize,
  },
};

export default plugin;
