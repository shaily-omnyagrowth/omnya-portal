import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import Icon from "../../ui/Icon";
import VideoThumb from "../../ui/VideoThumb";
import { fmtCompactNum, fmtDate, fmtPct, platformMeta } from "../../utils";

export default function PostCard({ post, onSelect }) {
  const p = platformMeta(post.platformKey);
  const body = (
    <>
      <div className="post-media">
        <VideoThumb sub={post} fluid ratio={0.9} radius={0} platform={post.platformKey} />
        <span className="post-platform"><Icon icon={p.icon} size={12} />{p.name}</span>
      </div>
      <div className="post-body">
        <div className="fw-600 fs-14 truncate">{post.creatorName}</div>
        <div className="fs-12 text-muted truncate">{post.campaignName}</div>
        <div className="post-stats">
          <span><strong>{fmtCompactNum(post.views)}</strong> views</span>
          <span><strong>{fmtPct(post.engRate)}</strong> engaged</span>
        </div>
        <div className="post-meta">
          <span>{fmtCompactNum(post.likes)} likes · {fmtCompactNum(post.comments)} comments</span>
          <span>{fmtDate(post.date)}</span>
        </div>
      </div>
    </>
  );
  return (
    <article className="post-card">
      {onSelect ? <button className="post-hit" onClick={() => onSelect(post)} aria-label={`Open ${post.creatorName}, ${post.campaignName}`}>{body}</button> : <div>{body}</div>}
      {post.postUrl && (
        <a className="btn btn-secondary btn-icon btn-sm post-open" href={post.postUrl} target="_blank" rel="noreferrer" aria-label="Watch on the platform" onClick={e => e.stopPropagation()}>
          <Icon icon={ArrowUpRight01Icon} size={14} />
        </a>
      )}
    </article>
  );
}
