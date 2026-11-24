import Drum from "./Drum";

export default function Cta({ onRandom, onBrowse }: { onRandom: () => void; onBrowse: () => void }) {
  return (
    <section id="contact" className="cta">
      <h2 className="cta-title">
        Put your eye on it.
        <br />
        See where
        <br />
        it <span className="paren">(</span>
        <Drum word="goes" />
        <span className="paren">)</span>
      </h2>
      <p className="cta-sub">不用登录，不用设置，直接看。</p>
      <div className="cta-actions">
        <button className="btn btn--dark" onClick={onRandom}>
          随便看看 <span aria-hidden="true">→</span>
        </button>
        <button className="btn btn--line" onClick={onBrowse}>
          浏览全部 <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
