import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[FairLab ErrorBoundary caught error]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleGoDashboard = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (typeof window !== 'undefined') {
      window.location.href = '/dashboard';
    }
  };

  render() {
    if (this.state.hasError) {
      const fallbackTitle = this.props.fallbackTitle || 'An unexpected error occurred in this view';
      return (
        <div className="w-full max-w-2xl mx-auto my-8 p-6 sm:p-8 rounded-2xl bg-white border border-[#E2E8F0] shadow-sm text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px]">warning</span>
          </div>

          <h2 className="text-lg font-bold text-[#0F172A] tracking-tight">
            {fallbackTitle}
          </h2>

          <p className="text-xs text-[#64748B] mt-1.5 max-w-md mx-auto">
            FairLab caught a component render issue. The application shell and other views remain fully operational.
          </p>

          {this.state.error?.message && (
            <div className="mt-4 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-left max-w-lg mx-auto">
              <div className="text-[11px] font-mono font-semibold text-[#DC2626] break-words">
                {this.state.error.name}: {this.state.error.message}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              <span>Reload View</span>
            </button>

            <button
              type="button"
              onClick={this.handleGoDashboard}
              className="px-4 py-2 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#334155] text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">home</span>
              <span>Return to Dashboard</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
