import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { common } from 'lowlight';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import groovy from 'highlight.js/lib/languages/groovy';
import protobuf from 'highlight.js/lib/languages/protobuf';
import http from 'highlight.js/lib/languages/http';
import { Link } from 'react-router-dom';
import { playground, type PgLang } from '../lib/playgroundStore';

const RUNNABLE: Record<string, PgLang> = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts' };
const LABEL: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', jsx: 'JSX', tsx: 'TSX',
  node: 'Node.js', tstype: 'TypeScript · types only', tslib: 'TypeScript', java: 'Java', kotlin: 'Kotlin', kt: 'Kotlin', python: 'Python', py: 'Python', sql: 'SQL', pgsql: 'PostgreSQL', postgres: 'PostgreSQL', postgresql: 'PostgreSQL', mysql: 'MySQL', bash: 'Shell',
  sh: 'Shell', json: 'JSON', yaml: 'YAML', yml: 'YAML', lua: 'Lua', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS',
  dockerfile: 'Dockerfile', nginx: 'Nginx', text: 'Text', vue: 'Vue SFC', groovy: 'Groovy', diff: 'Diff', graphql: 'GraphQL',
  protobuf: 'Protobuf', proto: 'Protobuf', http: 'HTTP', mongo: 'MongoDB shell', redis: 'Redis CLI', cql: 'CQL (Cassandra)',
  properties: 'Properties', toml: 'TOML', ini: 'INI', plsql: 'PL/pgSQL', cypher: 'Cypher (Neo4j)', esquery: 'Elasticsearch query',
};

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: HastNode[] };

const textOf = (n: HastNode | undefined): string =>
  !n ? '' : n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join('');

function CodeBlock({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const codeEl = node?.children?.find((c) => c.tagName === 'code');
  const classes = (codeEl?.properties?.className as string[] | undefined) ?? [];
  const lang = classes.find((c) => c.startsWith('language-'))?.slice(9).toLowerCase() ?? 'text';
  const raw = textOf(codeEl).replace(/\n$/, '');
  const runLang = RUNNABLE[lang];
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="codeblock" data-lang={lang}>
      <div className="codeblock-bar">
        <span className="codeblock-lang">{LABEL[lang] ?? lang}</span>
        <span className="codeblock-actions">
          <button type="button" className="btn-ghost btn-xs" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          {runLang && (
            <>
              <button type="button" className="btn-ghost btn-xs" onClick={() => playground.load(raw, runLang, false)} title="Open in playground without running">
                Edit
              </button>
              <button type="button" className="btn-run btn-xs" onClick={() => playground.load(raw, runLang, true)} title="Run in the floating playground">
                ▶ Run
              </button>
            </>
          )}
        </span>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ node, children }) => <CodeBlock node={node as unknown as HastNode}>{children}</CodeBlock>,
  a: ({ href = '', children }) =>
    href.startsWith('/') ? (
      <Link to={href}>{children}</Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ),
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
};

const rehypePlugins: Parameters<typeof ReactMarkdown>[0]['rehypePlugins'] = [
  [
    rehypeHighlight,
    {
      languages: { ...common, dockerfile, nginx, groovy, protobuf, http },
      aliases: { javascript: ['node', 'mongo'], typescript: ['tstype', 'tslib'], xml: ['vue'], protobuf: ['proto'], sql: ['cql', 'plsql', 'pgsql', 'postgres', 'postgresql', 'mysql'], ini: ['properties', 'toml'], plaintext: ['redis', 'cypher'], json: ['esquery'] },
    },
  ],
];
const remarkPlugins = [remarkGfm];

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
