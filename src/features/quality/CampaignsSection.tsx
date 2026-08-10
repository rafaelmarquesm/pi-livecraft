// dprint-ignore-file -- dprint 0.55 formats this TSX file non-deterministically.
import { useEffect, useMemo, useState } from 'react'
import { getQualityCampaign } from '../../api.ts'
import type {
  QualityCampaignArmDetail,
  QualityCampaignDetailResponse,
  QualityCampaignListItem,
} from '../../../shared/quality-campaigns.ts'

export function CampaignsSection({ campaigns }: { campaigns: QualityCampaignListItem[] }) {
  const [selectedId, setSelectedId] = useState(campaigns[0]?.id ?? '')
  const [detail, setDetail] = useState<QualityCampaignDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!campaigns.some((campaign) => campaign.id === selectedId)) {
      setSelectedId(campaigns[0]?.id ?? '')
    }
  }, [campaigns, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void getQualityCampaign(selectedId)
      .then((campaign) => {
        if (!cancelled) setDetail(campaign)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const selected = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedId) ?? campaigns[0],
    [campaigns, selectedId],
  )

  if (campaigns.length === 0) return null

  return (
    <section className='quality-card quality-campaigns' aria-labelledby='quality-campaigns-title'>
      <div className='quality-campaigns-header'>
        <div>
          <h3 id='quality-campaigns-title'>Campaigns</h3>
          <p>Raw artifacts, validity gates, uncertainty, cost, time, and invalidity reasons.</p>
        </div>
        <label>
          Campaign
          <select value={selectedId} onChange={(event) => setSelectedId(event.currentTarget.value)}>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.id}</option>
            ))}
          </select>
        </label>
      </div>
      {selected && <CampaignSummary campaign={selected} />}
      {loading && <p className='quality-muted'>Loading campaign artifact…</p>}
      {error && <p className='quality-error' role='alert'>{error}</p>}
      {detail && detail.id === selectedId && <CampaignDetail detail={detail} />}
    </section>
  )
}

function CampaignSummary({ campaign }: { campaign: QualityCampaignListItem }) {
  return (
    <p className='quality-muted'>
      {campaign.arms.join(' vs ')} · {campaign.validTrials} valid · {campaign.invalidTrials} invalid
      {campaign.smallSample ? ' · small sample' : ''}
    </p>
  )
}

function CampaignDetail({ detail }: { detail: QualityCampaignDetailResponse }) {
  const invalidReasons = Object.entries(detail.invalidReasons).filter(([, count]) => count > 0)
  const winnerText = detail.winner
    ? `Winner: ${detail.winner.arm}. ${detail.winner.reason}.`
    : `No winner: ${
      detail.winnerSuppressedReasons.length
        ? detail.winnerSuppressedReasons.join(', ')
        : 'winner conditions were not met'
    }.`
  return (
    <div className='quality-campaign-detail'>
      <dl className='quality-metrics'>
        <Metric label='Campaign id' value={detail.id} />
        <Metric label='Generated' value={formatDate(detail.generatedAt)} />
        <Metric label='Livecraft' value={detail.provenance.livecraftRevision ?? 'n/a'} />
        <Metric label='Pi' value={detail.provenance.piVersion ?? 'n/a'} />
        <Metric label='Requested' value={triple(detail.provenance.requested)} />
        <Metric label='Observed' value={triple(detail.provenance.observed)} />
        <Metric label='Manifest SHA-256' value={shortHash(detail.provenance.manifestFingerprint)} />
        <Metric label='Environment' value={environment(detail.provenance.environment)} />
      </dl>

      <div className='quality-campaign-notice'><strong>{winnerText}</strong></div>
      <ArmTable arms={detail.arms} />
      <PairedDeltas detail={detail} />
      <ProgressSummary detail={detail} />
      <InvalidReasons invalidReasons={invalidReasons} />
    </div>
  )
}

function ArmTable({ arms }: { arms: QualityCampaignArmDetail[] }) {
  return (
    <div className='quality-campaign-table-wrap'>
      <table className='quality-campaign-table'>
        <caption>Arm metrics include valid and invalid trials, pass rates, intervals, cost, tokens, and time.</caption>
        <thead>
          <tr>
            <th>Arm</th>
            <th>Valid/invalid</th>
            <th>pass@1</th>
            <th>pass@k</th>
            <th>Wilson CI</th>
            <th>Score</th>
            <th>Cost</th>
            <th>Tokens</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>{arms.map((arm) => <ArmRow arm={arm} key={arm.arm} />)}</tbody>
      </table>
    </div>
  )
}

function ArmRow({ arm }: { arm: QualityCampaignArmDetail }) {
  const tokens = arm.tokens.input + arm.tokens.output + arm.tokens.cacheRead + arm.tokens.cacheWrite
  const wilson = arm.wilson === null
    ? 'n/a'
    : `${formatPercent(arm.wilson.lower)} to ${formatPercent(arm.wilson.upper)}`
  return (
    <tr>
      <th scope='row'>{arm.arm}</th>
      <td>{arm.validTrials}/{arm.invalidTrials}</td>
      <td>{formatPercent(arm.passAt1)}</td>
      <td>{formatPercent(arm.passAtK)}</td>
      <td>{wilson}</td>
      <td>{formatNumber(arm.score.mean)} mean · {formatNumber(arm.score.sampleSd)} sd</td>
      <td>{formatUsd(arm.costUsd)} total · {formatUsd(arm.costPerSuccess)} / success</td>
      <td>{tokens}</td>
      <td>{formatDuration(arm.durationMs)}</td>
    </tr>
  )
}

function PairedDeltas({ detail }: { detail: QualityCampaignDetailResponse }) {
  if (detail.pairedDeltas.length === 0) return null
  return (
    <div>
      <h4>Paired deltas by task/seed</h4>
      <ul>
        {detail.pairedDeltas.map((delta) => (
          <li key={`${delta.taskId}:${delta.seed}:${delta.leftArm}:${delta.rightArm}`}>
            {delta.taskId}/{delta.seed}: {delta.leftArm} {formatNumber(delta.left)} → {delta.rightArm}{' '}
            {formatNumber(delta.right)} ({delta.delta >= 0 ? '+' : ''}{formatNumber(delta.delta)})
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProgressSummary({ detail }: { detail: QualityCampaignDetailResponse }) {
  return (
    <div>
      <h4>Progress over time</h4>
      <ul>
        {detail.progress.map((series) => {
          const last = series.points.at(-1)
          const passText = last?.bestPassed ? 'pass observed' : 'no pass observed'
          return (
            <li key={series.arm}>
              {series.arm}: {series.points.length} points, best score{' '}
              {formatNumber(last?.bestScore ?? null)}, {passText}.
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function InvalidReasons({ invalidReasons }: { invalidReasons: Array<[string, number]> }) {
  return (
    <div>
      <h4>Invalid reasons</h4>
      {invalidReasons.length
        ? (
          <ul>{invalidReasons.map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}</ul>
        )
        : <p>No invalid trials recorded.</p>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function triple(value: { provider: string; model: string; thinking: string } | null): string {
  return value ? `${value.provider}/${value.model}/${value.thinking}` : 'n/a'
}

function environment(value: { node: string; os: string; arch: string } | null): string {
  return value ? `${value.node} ${value.os}/${value.arch}` : 'n/a'
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toISOString().slice(0, 10)
}

function shortHash(value: string): string {
  return value.length > 16 ? value.slice(0, 16) : value
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 1000) / 10}%`
}

function formatNumber(value: number | null, digits = 3): string {
  return value === null ? 'n/a' : value.toFixed(digits)
}

function formatUsd(value: number | null): string {
  return value === null ? 'n/a' : `$${value.toFixed(4)}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}
