import { ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <main className="notfound">
      <h1 className="h-display">Not here</h1>
      <p>这条灵感不存在，或者还没部署上线。</p>
      <a className="btn btn--dark" href="/">
        回到首页 <ArrowRight className="ic-go" />
      </a>
    </main>
  );
}
