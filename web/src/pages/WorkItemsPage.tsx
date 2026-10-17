import React, { useState, useEffect } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  X,
  ArrowRight,
} from "lucide-react";
import { itemsApi } from "../api/items";
import { useAuth } from "../hooks/useAuth";
import { WorkItemTable } from "../components/items/WorkItemTable";
import { WorkItemForm } from "../components/items/WorkItemForm";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorState } from "../components/common/ErrorState";

export const WorkItemsPage: React.FC = () => {
  const { user, memberships, activeTeamId, activeTeam } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Filters from URL
  const initialSearch = searchParams.get("search") || "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);

  const status = searchParams.get("status") || "";
  const priority = searchParams.get("priority") || "";
  const type = searchParams.get("type") || "";
  const teamId = searchParams.get("teamId") || activeTeamId || "";
  const myOnly = searchParams.get("my") === "true";

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
      const next = new URLSearchParams(searchParams);
      if (searchInput.trim()) {
        next.set("search", searchInput.trim());
      } else {
        next.delete("search");
      }
      setSearchParams(next);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchInput]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next);
  };

  const clearFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setSearchParams(new URLSearchParams());
  };

  // TanStack useInfiniteQuery: all filters in queryKey ensures filter change resets cursor to page 1
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useInfiniteQuery({
    queryKey: [
      "items-list",
      {
        teamId: teamId || undefined,
        status: status || undefined,
        priority: priority || undefined,
        type: type || undefined,
        search: debouncedSearch || undefined,
        assigneeId: myOnly && user ? user.id : undefined,
      },
    ],
    queryFn: ({ pageParam }) =>
      itemsApi.listItems({
        teamId: teamId || undefined,
        status: status || undefined,
        priority: priority || undefined,
        type: type || undefined,
        search: debouncedSearch || undefined,
        assigneeId: myOnly && user ? user.id : undefined,
        cursor: pageParam || undefined,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });

  const items = data ? data.pages.flatMap((page) => page.items) : [];
  const totalLoaded = items.length;
  const canCreate = activeTeam?.role === "member" || activeTeam?.role === "lead";
  const hasActiveFilters = !!(debouncedSearch || status || priority || type || myOnly);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Work Items
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Browse, triage, and execute operational tasks across assigned teams.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>

          {canCreate && (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-3.5 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Item</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-[#12141c]/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input (Debounced 300ms) */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title or description (debounced full-text index)..."
              className="w-full bg-slate-900/90 border border-slate-800 rounded-lg pl-9 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter: My Assigned */}
          <button
            type="button"
            onClick={() => updateFilter("my", myOnly ? "" : "true")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
              myOnly
                ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
            }`}
          >
            Assigned to Me
          </button>
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-800/60 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-medium">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters:</span>
          </div>

          {/* Status Filter */}
          <select
            value={status}
            onChange={(e) => updateFilter("status", e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-300 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priority}
            onChange={(e) => updateFilter("priority", e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-300 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Priorities</option>
            <option value="P0">P0 - Critical</option>
            <option value="P1">P1 - High</option>
            <option value="P2">P2 - Medium</option>
            <option value="P3">P3 - Low</option>
          </select>

          {/* Type Filter */}
          <select
            value={type}
            onChange={(e) => updateFilter("type", e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-300 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="">All Types</option>
            <option value="task">Task</option>
            <option value="incident">Incident</option>
            <option value="payment">Payment</option>
            <option value="compliance">Compliance</option>
          </select>

          {/* Team Filter */}
          <select
            value={teamId}
            onChange={(e) => updateFilter("teamId", e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-300 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="">All My Teams</option>
            {memberships.map((m) => (
              <option key={m.team_id} value={m.team_id}>
                {m.team_name}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-indigo-400 hover:text-indigo-300 ml-auto flex items-center gap-1 font-medium cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* Items Table View */}
      {error ? (
        <ErrorState
          title="Failed to load work items"
          message={(error as any)?.message || "Network or server error"}
          onRetry={refetch}
        />
      ) : items.length === 0 && !isLoading ? (
        <EmptyState
          title="No work items match your criteria"
          description={
            hasActiveFilters
              ? "Try adjusting or resetting your active filters above."
              : "No items exist in this workspace yet. Create the first one to start collaborating."
          }
          action={
            canCreate
              ? {
                  label: "Create Work Item",
                  onClick: () => setIsCreateOpen(true),
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <WorkItemTable items={items} isLoading={isLoading} />

          {/* Load More / Infinite Keyset Pagination */}
          <div className="flex flex-col items-center justify-center pt-2 pb-6 gap-2">
            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-6 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isFetchingNextPage ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <span>Loading more items...</span>
                  </>
                ) : (
                  <>
                    <span>Load more work items</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            )}

            {!hasNextPage && items.length > 0 && (
              <div className="text-center py-2 text-xs text-slate-500 font-mono">
                No more items ({totalLoaded} loaded)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Work Item Modal */}
      <WorkItemForm
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["items-list"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />
    </div>
  );
};
