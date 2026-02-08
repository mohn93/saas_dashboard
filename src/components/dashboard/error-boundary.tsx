"use client";

import React from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ChartErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardContent className="flex h-[200px] items-center justify-center p-6">
            <div className="flex items-center text-muted-foreground">
              <AlertCircle className="mr-2 h-4 w-4" />
              <span className="text-sm">
                {this.props.fallbackMessage || "Failed to load this section"}
              </span>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
