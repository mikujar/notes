import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 子树渲染抛错时避免整页白屏无提示；错误仍会出现在控制台（componentDidCatch）。
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[未来罐] React 渲染错误", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            boxSizing: "border-box",
            minHeight: "100dvh",
            padding: 24,
            fontFamily:
              'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
            background: "#f9f9f9",
            color: "#3c3c43",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", margin: "0 0 12px" }}>
            页面加载出错
          </h1>
          <p style={{ margin: "0 0 8px", fontSize: "0.875rem", color: "#67676c" }}>
            请截图本页或控制台中的「未来罐」报错后反馈。可尝试刷新页面。
          </p>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: "#fff",
              border: "1px solid rgba(55,53,47,0.12)",
              fontSize: "0.75rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
