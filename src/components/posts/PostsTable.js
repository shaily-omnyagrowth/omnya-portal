import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import Icon from "../../ui/Icon";
import VideoThumb from "../../ui/VideoThumb";
import { fmtCompactNum, fmtDate, fmtPct, platformMeta } from "../../utils";
import usePagination from "../../ui/Pagination";

export default function PostsTable({ posts, onSelect }) {
  const { rows, pager } = usePagination(posts, { label: "videos" });
  return (
    <>
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Video</th><th>Platform</th><th className="num">Views</th><th className="num">Likes</th>
            <th className="num">Comments</th><th className="num">Shares</th><th className="num">Engagement</th><th>Posted</th><th><span className="sr-only">Link</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(post => {
            const p = platformMeta(post.platformKey);
            return (
              <tr key={post.id} onClick={onSelect ? () => onSelect(post) : undefined} style={onSelect ? { cursor: "pointer" } : undefined}>
                <td>
                  <span className="flex-center gap-12" style={{ minWidth: 220 }}>
                    <VideoThumb sub={post} width={32} platform={post.platformKey} radius={6} />
                    <span style={{ minWidth: 0 }}>
                      <span className="fw-600 truncate" style={{ display: "block", color: "var(--ink)", maxWidth: 260 }}>{post.creatorName}</span>
                      <span className="fs-12 text-muted truncate" style={{ display: "block", maxWidth: 260 }}>{post.campaignName}</span>
                    </span>
                  </span>
                </td>
                <td><span className="flex-center gap-4"><Icon icon={p.icon} size={14} />{p.name}</span></td>
                <td className="num fw-600" style={{ color: "var(--ink)" }}>{fmtCompactNum(post.views)}</td>
                <td className="num">{fmtCompactNum(post.likes)}</td>
                <td className="num">{fmtCompactNum(post.comments)}</td>
                <td className="num">{fmtCompactNum(post.shares)}</td>
                <td className="num">{fmtPct(post.engRate)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(post.date)}</td>
                <td className="num">
                  {post.postUrl && <a className="btn btn-ghost btn-icon btn-sm" href={post.postUrl} target="_blank" rel="noreferrer" aria-label="Watch on the platform" onClick={e => e.stopPropagation()}><Icon icon={ArrowUpRight01Icon} size={14} /></a>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {pager}
    </>
  );
}
