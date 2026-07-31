import React, { useState } from 'react';
import { DashLink } from '../../DashLink';
import { getItemDetail } from './itemDetail';
import { isItemIdentical } from './identicalItems';
import { GROUP_TO_CAPABILITY, type DOConfig, type D1Config, type ResourceGroup } from './groups';

export function CollapsibleGroup({
  group,
  selected,
  onToggleAll,
  onToggleItem,
  defaultExpanded = false,
  doConfigs,
  setDoConfigs,
  d1Configs,
  setD1Configs,
  r2Credentials,
  setR2Credentials,
  sourceAccountId,
  sourceZoneName,
  destAccountId,
  acknowledgments,
  setAcknowledgments,
  showToast,
  identicalSet,
  doStateCopyDisabledReason,
}: {
  group: ResourceGroup;
  selected: Record<string, boolean>;
  onToggleAll: (groupKey: string, value: boolean) => void;
  onToggleItem: (groupKey: string, itemId: string, value: boolean) => void;
  /** Start expanded (e.g. Durable Objects that need configuration) */
  defaultExpanded?: boolean;
  /** DO config state - when provided, renders inline DO configuration per item */
  doConfigs?: Record<string, DOConfig>;
  setDoConfigs?: React.Dispatch<React.SetStateAction<Record<string, DOConfig>>>;
  /** D1 config state - when provided, renders inline D1 migration commands per item */
  d1Configs?: Record<string, D1Config>;
  setD1Configs?: React.Dispatch<React.SetStateAction<Record<string, D1Config>>>;
  /** R2 S3 credentials for object data migration */
  r2Credentials?: { source: { accessKeyId: string; secretAccessKey: string }; dest: { accessKeyId: string; secretAccessKey: string } };
  setR2Credentials?: React.Dispatch<React.SetStateAction<{ source: { accessKeyId: string; secretAccessKey: string }; dest: { accessKeyId: string; secretAccessKey: string } }>>;
  sourceAccountId?: string;
  /** Source zone name (e.g. "example.com") - used to deep-link each element
   * into the source account's dashboard. */
  sourceZoneName?: string;
  destAccountId?: string;
  /** Pre-migration acknowledgments - when the capability key for this group is in the set, treat as acknowledged (selectable despite missing capability) */
  acknowledgments?: Set<string>;
  setAcknowledgments?: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Show an in-app toast (replaces native alert(); see App.tsx). */
  showToast?: (message: string, type?: 'error' | 'success') => void;
  /** Keys of resources already identical on the destination (overwrite mode). */
  identicalSet?: Set<string>;
  doStateCopyDisabledReason?: string;
}) {
  const isDOGroup = !!doConfigs && !!setDoConfigs;
  const isD1Group = !!d1Configs && !!setD1Configs;
  const isR2Group = !!r2Credentials && !!setR2Credentials;
  const isConfigGroup = isDOGroup || isD1Group;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const capabilityKey = GROUP_TO_CAPABILITY[group.key];
  // Context for deep-linking each row into the SOURCE account's dashboard.
  const sourceDashCtx = { accountId: sourceAccountId, zoneName: sourceZoneName };
  const isAcknowledged = !!group.disabled && !!capabilityKey && !!acknowledgments?.has(capabilityKey);
  const enabledItems = group.items.filter((i) => !i.disabled);
  const selectedCount = enabledItems.filter((i) => selected[i.id]).length;
  const allSelected = enabledItems.length > 0 && selectedCount === enabledItems.length;
  const someSelected = selectedCount > 0 && !allSelected;
  // A group is effectively disabled only if it's capability-gated AND not acknowledged
  const isDisabled = !!group.disabled && !isAcknowledged;
  const canExpand = true;

  const updateDOConfig = setDoConfigs ? (workerName: string, update: Partial<DOConfig>) => {
    setDoConfigs((prev) => {
      const existing = prev[workerName] ?? { enabled: false, objectNames: '', sourceUrl: '', destUrl: '' };
      return { ...prev, [workerName]: { ...existing, ...update } };
    });
  } : undefined;

  // Whether this group can be acknowledged (disabled due to missing capability, not a config group)
  const canAcknowledge = !!group.disabled && !!capabilityKey && !isConfigGroup && !!setAcknowledgments;

  return (
    <div className={`border rounded-lg overflow-hidden ${
      isAcknowledged ? 'border-gray-700' :
      isDisabled && !isConfigGroup ? 'border-gray-700/50 opacity-60' : 'border-gray-700'
    }`}>
      <div
        className={`flex items-center gap-3 px-4 py-3 select-none ${
          canExpand ? 'hover:bg-gray-700 cursor-pointer' : 'cursor-not-allowed'
        }`}
        style={{ backgroundColor: 'rgb(38, 42, 51)' }}
        onClick={() => canExpand && setExpanded(!expanded)}
      >
        <input
          type="checkbox"
          checked={isAcknowledged ? allSelected : (!isDisabled && allSelected)}
          disabled={isDisabled && !isConfigGroup}
          ref={(el) => {
            if (el) el.indeterminate = isAcknowledged ? someSelected : (!isDisabled && someSelected);
          }}
          onChange={(e) => {
            e.stopPropagation();
            if (isConfigGroup && enabledItems.length === 0) {
              const msg = isDOGroup
                ? 'Configure all Durable Object namespaces below before selecting this group.'
                : 'Acknowledge the manual migration commands for each database below first.';
              showToast?.(msg, 'error');
              if (!expanded) setExpanded(true);
              return;
            }
            if (!isDisabled || isAcknowledged) onToggleAll(group.key, !allSelected);
          }}
          onClick={(e) => e.stopPropagation()}
          className={`w-4 h-4 rounded border-gray-600 focus:ring-offset-gray-800 bg-gray-700 ${
            isDisabled && !isConfigGroup ? 'cursor-not-allowed opacity-50' :
            isAcknowledged ? 'text-gray-400 focus:ring-gray-500 cursor-pointer' :
            'text-orange-500 focus:ring-orange-500 cursor-pointer'
          }`}
        />
        <span className={`text-base ${isDisabled && !isConfigGroup ? 'grayscale' : ''}`}>{group.icon}</span>
        <div className="flex-1 min-w-0">
          <span className={`font-medium ${
            isAcknowledged ? 'text-gray-300' :
            isDisabled && !isConfigGroup ? 'text-gray-500' : 'text-gray-100'
          }`}>{group.label}</span>
          {/* Category-level dashboard link — opens this resource type's section
              in the source dashboard. Renders nothing for unmapped groups. */}
          <span className="ml-2 align-middle">
            <DashLink
              groupKey={group.key}
              ctx={sourceDashCtx}
              title={`Open ${group.label} in the source dashboard`}
            />
          </span>
          {/* Selected/total count, inline next to the name (e.g. "(16/16)") so
              the right edge is reserved for the expand affordance and isn't
              mistaken for context. */}
          {(isAcknowledged || !isDisabled) && enabledItems.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({selectedCount}/{enabledItems.length})
              {enabledItems.length < group.items.length && (
                <span className="text-yellow-400/60 ml-1">({group.items.length - enabledItems.length} need config)</span>
              )}
            </span>
          )}
          {isAcknowledged && (
            <div className="text-xs mt-0.5 text-gray-500">Will attempt migration - failures will be marked as acknowledged</div>
          )}
          {isDisabled && !isAcknowledged && group.disabledReason && (
            <div className={`text-xs mt-0.5 ${isConfigGroup ? 'text-yellow-400/80' : 'text-red-400/80'}`}>{group.disabledReason}</div>
          )}
          {isDisabled && !isAcknowledged && group.disabledAction && (
            <div className="text-xs text-gray-500 mt-0.5">{group.disabledAction}</div>
          )}
        </div>
        {!isDisabled && !isAcknowledged && enabledItems.length === 0 && group.items.length > 0 && isConfigGroup && (
          <span className="text-xs font-medium text-yellow-400/70 bg-yellow-900/20 px-2 py-0.5 rounded">
            {group.items.length} need config
          </span>
        )}
        {!isDisabled && !isAcknowledged && enabledItems.length === 0 && group.items.length > 0 && !isConfigGroup && (
          <span className="text-xs font-medium text-yellow-400/70 bg-yellow-900/20 px-2 py-0.5 rounded">
            {group.items.length} skipped
          </span>
        )}
        {isAcknowledged && (
          <span className="text-xs font-medium text-gray-400 bg-gray-700/50 px-2 py-0.5 rounded">
            Acknowledged
          </span>
        )}
        {isDisabled && !isAcknowledged && !isConfigGroup && (
          <span className="text-xs font-medium text-red-400/70 bg-red-900/20 px-2 py-0.5 rounded">
            Not available - re-check above
          </span>
        )}
        {canExpand && (
          // Real <button> so keyboard/SR users can expand the group to audit
          // its resources (Principle 8). The row <div> also toggles on click as
          // a mouse convenience, but it can't be the keyboard control because it
          // wraps the interactive select-all checkbox (nested-interactive). The
          // button stops propagation so a row click doesn't double-toggle.
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`group-panel-${group.key}`}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.label}`}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 ml-1 p-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-600/60 cursor-pointer"
          >
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {expanded && canExpand && (
        <div id={`group-panel-${group.key}`} className="divide-y divide-gray-700/50">
          {/* Capability acknowledgment banner - shown when group is disabled due to missing entitlement */}
          {!!group.disabled && canAcknowledge && (
            <div className={`px-4 py-3 ${isAcknowledged ? 'bg-gray-800/40' : 'bg-red-900/10'}`}>
              <div className="flex items-start gap-3">
                <span className="text-sm mt-0.5">{isAcknowledged ? '\u2611\uFE0F' : '\u26A0\uFE0F'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${isAcknowledged ? 'text-gray-400' : 'text-red-300'}`}>
                    {group.disabledReason}
                  </p>
                  {!isAcknowledged && group.disabledAction && (
                    <p className="text-xs text-gray-500 mt-1">{group.disabledAction}</p>
                  )}
                  <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isAcknowledged}
                      onChange={(e) => {
                        setAcknowledgments!(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(capabilityKey!);
                          else next.delete(capabilityKey!);
                          return next;
                        });
                      }}
                      className="rounded border-gray-600 bg-gray-700 text-gray-400 focus:ring-gray-500/50"
                    />
                    <span className="text-xs text-gray-400">
                      {isAcknowledged
                        ? 'Acknowledged - these items will attempt migration and failures will be marked as acknowledged'
                        : 'I understand this feature is unavailable and items will fail - include them anyway'}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
          {/* DO info banner */}
          {isDOGroup && (
            <div className="px-4 py-2">
              <p className="text-xs text-gray-500">
                DO namespaces are created when workers are deployed.
                To migrate stored data, enable migration per worker and provide the object names used with{' '}
                <code className="text-orange-400">idFromName()</code>.
              </p>
            </div>
          )}
          {/* D1 info banner — disclosure only (#15): D1 dbs are freely
              selectable and created empty; the schema+data copy is listed as
              post-migration work on the Apply step, so there is no gate here. */}
          {group.key === 'd1Databases' && (
            <div className="px-4 py-2">
              <p className="text-xs text-gray-500">
                Only empty databases are created automatically. Schema and data must be migrated manually with{' '}
                <code className="text-orange-400">wrangler d1</code> after migration completes &mdash; the exact
                commands are listed on the Apply step.
              </p>
            </div>
          )}
          {/* R2 credentials panel - shared across all buckets */}
          {isR2Group && setR2Credentials && (
            <div className="px-4 py-3 border-b border-gray-700/50">
              <div className="rounded-lg p-3 bg-gray-700/50 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-300">R2 Data Migration</span>
                  {r2Credentials.source.accessKeyId && r2Credentials.dest.accessKeyId ? (
                    <span className="text-xs font-medium text-green-400/80 bg-green-900/20 px-1.5 py-0.5 rounded">Credentials set</span>
                  ) : (
                    <span className="text-xs font-medium text-gray-500 bg-gray-600/30 px-1.5 py-0.5 rounded">Optional</span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  Buckets are always created. To also copy object data, provide R2 S3 API credentials for both accounts.
                  Create tokens at{' '}
                  <span className="text-orange-400">Cloudflare Dashboard &gt; R2 &gt; Manage R2 API Tokens</span>.
                  Each token needs <code className="text-orange-400">Object Read</code> (source) or <code className="text-orange-400">Object Read &amp; Write</code> (destination) permission.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Source credentials */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-400">Source Account</div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Access Key ID</label>
                      <input
                        type="text"
                        value={r2Credentials.source.accessKeyId}
                        onChange={(e) => setR2Credentials(prev => ({ ...prev, source: { ...prev.source, accessKeyId: e.target.value } }))}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-2.5 py-1.5 text-xs text-gray-100 font-mono focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                        placeholder="abc123..."
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Secret Access Key</label>
                      <form className="contents" onSubmit={(e) => e.preventDefault()}>
                      <input
                        type="password"
                        value={r2Credentials.source.secretAccessKey}
                        onChange={(e) => setR2Credentials(prev => ({ ...prev, source: { ...prev.source, secretAccessKey: e.target.value } }))}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-2.5 py-1.5 text-xs text-gray-100 font-mono focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                        placeholder="secret..."
                        autoComplete="off"
                      />
                      </form>
                    </div>
                  </div>
                  {/* Destination credentials */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-400">Destination Account</div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Access Key ID</label>
                      <input
                        type="text"
                        value={r2Credentials.dest.accessKeyId}
                        onChange={(e) => setR2Credentials(prev => ({ ...prev, dest: { ...prev.dest, accessKeyId: e.target.value } }))}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-2.5 py-1.5 text-xs text-gray-100 font-mono focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                        placeholder="xyz789..."
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Secret Access Key</label>
                      <form className="contents" onSubmit={(e) => e.preventDefault()}>
                      <input
                        type="password"
                        value={r2Credentials.dest.secretAccessKey}
                        onChange={(e) => setR2Credentials(prev => ({ ...prev, dest: { ...prev.dest, secretAccessKey: e.target.value } }))}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-2.5 py-1.5 text-xs text-gray-100 font-mono focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                        placeholder="secret..."
                        autoComplete="off"
                      />
                      </form>
                    </div>
                  </div>
                </div>
                {(!r2Credentials.source.accessKeyId || !r2Credentials.source.secretAccessKey || !r2Credentials.dest.accessKeyId || !r2Credentials.dest.secretAccessKey) && (
                  <p className="text-xs text-gray-500 italic">
                    Without credentials, only empty buckets will be created. You can copy data later with rclone or the S3 API.
                  </p>
                )}
              </div>
            </div>
          )}
          {group.items.map((item, itemIndex) => {
            const isLastItem = itemIndex === group.items.length - 1;
            const itemIsDisabled = isDisabled || !!item.disabled;
            const doConfig = isDOGroup ? (doConfigs![item.id] ?? { enabled: false, objectNames: '', sourceUrl: '', destUrl: '' }) : null;
            // Advisory only: the destination already has this resource with
            // identical values, so overwriting is a no-op. The item stays
            // selected and migrated regardless (a harmless re-write) — the
            // badge just tells the user it won't change anything.
            const itemIsIdentical = !itemIsDisabled && !!identicalSet
              && isItemIdentical(identicalSet, group.key, item.raw);
            return (
              <div key={item.id}>
                <div className={`relative flex items-center gap-3 pl-9 pr-4 py-2 ${itemIsDisabled && !isConfigGroup ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700/30'}`}>
                  {/* Tree connector: a vertical trunk dropping from the category
                      header plus a horizontal tick into each row, so sub-settings
                      read as children of the category rather than peers. The
                      trunk stops at the tick on the last item to form the "└". */}
                  <span
                    aria-hidden="true"
                    className={`absolute left-[19px] w-px bg-gray-600/70 ${isLastItem ? 'top-0 h-1/2' : 'top-0 h-full'}`}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute left-[19px] top-1/2 h-px w-[13px] bg-gray-600/70"
                  />
                  <input
                    type="checkbox"
                    checked={itemIsDisabled ? false : !!selected[item.id]}
                    onChange={(e) => {
                      e.stopPropagation();
                      if (isConfigGroup && item.disabled) {
                        showToast?.('Enable data migration and provide object names for this worker first.', 'error');
                        return;
                      }
                      if (!itemIsDisabled) onToggleItem(group.key, item.id, !selected[item.id]);
                    }}
                    disabled={itemIsDisabled && !isConfigGroup}
                    className={`w-4 h-4 rounded border-gray-600 focus:ring-orange-500 focus:ring-offset-gray-800 bg-gray-700 ${itemIsDisabled && !isConfigGroup ? 'cursor-not-allowed opacity-50' : 'text-orange-500 cursor-pointer'}`}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedItemId === item.id}
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                    onKeyDown={(e) => {
                      // Keyboard users must be able to open a row to inspect its
                      // identifying detail (Principle 8 — auditable scope).
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedItemId(expandedItemId === item.id ? null : item.id);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium break-all ${itemIsDisabled && !isConfigGroup ? 'text-gray-500 line-through' : itemIsIdentical ? 'text-gray-400' : 'text-gray-200'}`}>{item.label}</span>
                      <DashLink
                        groupKey={group.key}
                        item={{ id: item.id, raw: item.raw }}
                        ctx={sourceDashCtx}
                        title={`Open "${item.label}" in the source dashboard`}
                      />
                      {itemIsIdentical && (
                        <span
                          className="text-xs font-medium text-gray-400 bg-gray-700/50 px-1.5 py-0.5 rounded flex-shrink-0"
                          title="The destination already has this resource with identical values — overwriting it changes nothing."
                        >
                          already identical on destination
                        </span>
                      )}
                      {isDOGroup && item.sublabel && (
                        <span className="text-xs text-gray-500">({item.sublabel})</span>
                      )}
                      {isConfigGroup && item.disabled && (
                        <span className="text-xs font-medium text-yellow-400/70 bg-yellow-900/20 px-1.5 py-0.5 rounded flex-shrink-0">
                          Needs configuration
                        </span>
                      )}
                      {itemIsDisabled && item.disabled && !isConfigGroup && (
                        <span className="text-xs font-medium text-red-400/70 bg-red-900/20 px-1.5 py-0.5 rounded flex-shrink-0">
                          Skipped
                        </span>
                      )}
                      <svg
                        className={`w-3 h-3 text-gray-500 transition-transform flex-shrink-0 ml-auto ${expandedItemId === item.id ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    {/* Curated identifying detail (AGENTS.md Principle 8): show
                        the values that define this resource, full-width and
                        untruncated, so an admin can verify what's migrating
                        without opening the raw-JSON expander. Per-type
                        formatters live in step2/itemDetail.ts; types without a
                        curated formatter get a generic key/value fallback. */}
                    {(() => {
                      const detail = getItemDetail(group.key, item.raw);
                      if (detail.length === 0) return null;
                      return (
                        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                          {detail.map((f, i) => (
                            <div key={`${f.label}-${i}`} className="flex items-baseline gap-1 min-w-0 max-w-full">
                              <dt className="text-gray-500 shrink-0">{f.label}:</dt>
                              <dd className={`text-gray-300 break-all ${f.mono ? 'font-mono' : ''}`}>{f.value}</dd>
                            </div>
                          ))}
                        </dl>
                      );
                    })()}
                    {itemIsDisabled && item.disabledReason && !isConfigGroup && (
                      <div className="text-xs text-red-400/70 break-words mt-1">{item.disabledReason}</div>
                    )}
                  </div>
                </div>
                {/* DO inline config */}
                {isDOGroup && doConfig && updateDOConfig && (
                  <div className="px-4 pb-3 ml-7">
                    <div className="rounded-lg p-3 bg-gray-700/50 space-y-2">
                      {doStateCopyDisabledReason && (
                        <p className="rounded border border-yellow-700/50 bg-yellow-900/20 p-2 text-xs text-yellow-300">
                          {doStateCopyDisabledReason}
                        </p>
                      )}
                      {/* Class badges */}
                      <div className="flex flex-wrap gap-1.5">
                        {(item.sublabel || '').split(', ').filter(Boolean).map((cls) => (
                          <span key={cls} className="px-2 py-0.5 bg-gray-600 rounded text-xs text-gray-300 font-mono">
                            {cls}
                          </span>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={doConfig.enabled}
                          onChange={(e) => updateDOConfig(item.id, { enabled: e.target.checked })}
                          disabled={!!doStateCopyDisabledReason}
                          className="rounded border-gray-600 bg-gray-700 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
                        />
                        <span className={doStateCopyDisabledReason ? 'text-gray-500' : 'text-gray-400'}>Enable data migration</span>
                      </label>
                      {doConfig.enabled && (
                        <div className="space-y-3 border-t border-gray-600 pt-3">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Object Names <span className="text-orange-400">*</span>
                              <span className="text-gray-500 ml-1">(comma-separated)</span>
                            </label>
                            <input
                              type="text"
                              value={doConfig.objectNames}
                              onChange={(e) => updateDOConfig(item.id, { objectNames: e.target.value })}
                              className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                              placeholder="user-123, session-abc, room-xyz"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                              The string names your app uses with <code className="text-orange-400/80">idFromName()</code>.
                            </p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Source Worker URL</label>
                              <input
                                type="text"
                                value={doConfig.sourceUrl}
                                onChange={(e) => updateDOConfig(item.id, { sourceUrl: e.target.value })}
                                className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                                placeholder={`https://${item.id}.account.workers.dev`}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Destination Worker URL</label>
                              <input
                                type="text"
                                value={doConfig.destUrl}
                                onChange={(e) => updateDOConfig(item.id, { destUrl: e.target.value })}
                                className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                                placeholder={`https://${item.id}.newaccount.workers.dev`}
                              />
                            </div>
                          </div>
                          {doConfig.enabled && !doConfig.objectNames.trim() && (
                            <div className="text-xs text-yellow-400/80">
                              Provide at least one object name to migrate stored state (the namespace is created either way).
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Raw JSON expandable (non-config items) */}
                {!isConfigGroup && expandedItemId === item.id && item.raw != null && (
                  <div className="pl-9 pr-4 pb-3 pt-1">
                    <pre className="bg-[#0d1117] text-[#c9d1d9] p-3 rounded-md text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto border border-[#30363d] leading-relaxed">
                      {JSON.stringify(item.raw, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
