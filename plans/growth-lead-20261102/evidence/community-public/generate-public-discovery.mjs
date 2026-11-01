import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreCommunity, projectJoinIntents, buildCommunityReceipt } from '../../../../src/community-engine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const capturedAt = '2026-11-02T01:20:00+07:00';
const repo = 'https://github.com/jangtrinh/design-os-studio';
const seeds = [
  ['facebook_group','UI UX Vietnam','ui-ux-vietnam','vi'],
  ['facebook_group','Figma Vietnam Community','figma-vietnam','vi'],
  ['facebook_group','Product Design Vietnam','product-design-vn','vi'],
  ['facebook_group','Design Systems Vietnam','design-systems-vn','vi'],
  ['facebook_group','AI Design Builders','ai-design-builders','en'],
  ['facebook_group','Claude Code Builders','claude-code-builders','en'],
  ['facebook_group','Codex and MCP Makers','codex-mcp-makers','en'],
  ['facebook_group','Build in Public Vietnam','build-in-public-vn','vi'],
  ['facebook_group','Figma Plugins and Agents','figma-plugins-agents','en'],
  ['facebook_group','UX Research and Product Design','ux-product-design','en'],
  ['facebook_group','Design Engineering Vietnam','design-engineering-vn','vi'],
  ['facebook_group','Open Source Design Tools','open-source-design-tools','en'],
  ['facebook_group','AI Agents for Designers','ai-agents-designers','en'],
  ['facebook_group','MCP Builders Vietnam','mcp-builders-vn','vi'],
  ['facebook_group','Product Makers Saigon','product-makers-saigon','vi'],
  ['linkedin_group','Product Design Systems','product-design-systems','en'],
  ['linkedin_group','Figma Community','figma-community','en'],
  ['linkedin_group','UX and Interface Design','ux-interface-design','en'],
  ['linkedin_group','AI Product Design','ai-product-design','en'],
  ['linkedin_group','Design Engineering','design-engineering','en'],
  ['linkedin_group','Open Source Product Builders','open-source-product-builders','en'],
  ['linkedin_group','Claude Code Community','claude-code-community','en'],
  ['linkedin_group','MCP and Agent Builders','mcp-agent-builders','en'],
  ['linkedin_group','Design Systems Leadership','design-systems-leadership','en'],
  ['linkedin_group','Vietnam Product Designers','vietnam-product-designers','vi'],
  ['linkedin_group','AI Agents in Product Teams','ai-agents-product-teams','en'],
  ['linkedin_group','UX Research Vietnam','ux-research-vietnam','vi'],
  ['linkedin_group','Build in Public Asia','build-in-public-asia','en'],
  ['linkedin_group','React and Design Systems','react-design-systems','en'],
  ['linkedin_group','Creative Technology Vietnam','creative-tech-vietnam','vi']
];
const evidenceHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const discoveries = seeds.map(([platform,name,slug,language], index) => {
  const url = platform === 'facebook_group' ? `https://www.facebook.com/groups/${slug}` : `https://www.linkedin.com/groups/${slug}/`;
  const basis = { platform, name, slug, language, capturedAt, source: 'public_candidate_seed', authenticated: false };
  const scored = scoreCommunity({
    id: `${platform}:public-${String(index + 1).padStart(2, '0')}`,
    platform, url, name,
    description: `Public discovery candidate for ${name}; no authenticated group read.`,
    sourceUrl: url, sourceType: 'public_discovery_fixture', capturedAt,
    observedHttpStatus: 'UNKNOWN', authenticatedGroupRead: false, loginShell: true,
    members: null, recentPosts: null, language,
    keywords: ['Figma','product design','design system','AI agents','Claude Code','Codex','MCP'],
    rules: { classification: 'unclear', sourceUrl: url, capturedAt, evidence: 'UNKNOWN: public candidate only; rules not fetched.' },
    evidenceRefs: [`sha256:${evidenceHash(basis)}`]
  });
  return { ...scored, publicEvidence: { classification: 'CANDIDATE_ONLY', authenticated: false, loginShell: 'UNKNOWN', evidenceHash: evidenceHash({ basis, normalized: scored }) } };
});
const joinProjection = projectJoinIntents({ accountId: 'linkedin_primary', observations: discoveries, priorRequests: [], now: capturedAt });
const receipt = buildCommunityReceipt({
  runId: 'community-public-discovery-20261102T0120+07', capturedAt,
  sourceReceipts: [{ sourceUrl: 'https://www.facebook.com/groups/', sourceType: 'public_candidate_fixture_seed', observedAt: capturedAt, observedHttpStatus: 'UNKNOWN', authenticatedGroupRead: false, loginShell: 'UNKNOWN', status: 'CANDIDATE_ONLY' }, { sourceUrl: 'https://www.linkedin.com/groups/', sourceType: 'public_candidate_fixture_seed', observedAt: capturedAt, observedHttpStatus: 'UNKNOWN', authenticatedGroupRead: false, loginShell: 'UNKNOWN', status: 'CANDIDATE_ONLY' }],
  discoveries, joinProjection, memberships: [],
  notes: ['30 deterministic public candidate rows: 15 Facebook Groups + 15 LinkedIn Groups.', 'No live crawl, login, credentials, cookies, membership data, join request, or external side effect.', 'All rules, member counts, activity, membership, approval, and postability remain UNKNOWN; fixture rows cannot enter a publication queue.', `Product context only: ${repo}`]
});
const output = path.resolve(here, 'community-public-discovery-20261102.json');
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ output, discoveries: receipt.discoveries.length, facebook: receipt.discoveries.filter(x=>x.platform==='facebook_group').length, linkedin: receipt.discoveries.filter(x=>x.platform==='linkedin_group').length, receiptHash: receipt.receiptHash, dashboard: receipt.dashboard }, null, 2));
