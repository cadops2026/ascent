export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          aggregator_ref: string | null
          balance_cached: number | null
          created_at: string
          id: string
          institution: string | null
          name: string
          tax_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aggregator_ref?: string | null
          balance_cached?: number | null
          created_at?: string
          id?: string
          institution?: string | null
          name: string
          tax_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aggregator_ref?: string | null
          balance_cached?: number | null
          created_at?: string
          id?: string
          institution?: string | null
          name?: string
          tax_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      alert_rules: {
        Row: {
          cadence: string
          narrative_pct: number | null
          rebalance_band_pt: number | null
          single_name_pct: number | null
          tlh_min_loss: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cadence?: string
          narrative_pct?: number | null
          rebalance_band_pt?: number | null
          single_name_pct?: number | null
          tlh_min_loss?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cadence?: string
          narrative_pct?: number | null
          rebalance_band_pt?: number | null
          single_name_pct?: number | null
          tlh_min_loss?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          created_at: string
          dismissed_at: string | null
          id: string
          kind: string
          payload: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          kind: string
          payload?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      asset_class_universe: {
        Row: {
          class: string
          cma_premium: number | null
          corr_to_us_equity: number | null
          cost_proxy: number | null
          gate: string | null
          liquidity: string | null
          vol: number | null
        }
        Insert: {
          class: string
          cma_premium?: number | null
          corr_to_us_equity?: number | null
          cost_proxy?: number | null
          gate?: string | null
          liquidity?: string | null
          vol?: number | null
        }
        Update: {
          class?: string
          cma_premium?: number | null
          corr_to_us_equity?: number | null
          cost_proxy?: number | null
          gate?: string | null
          liquidity?: string | null
          vol?: number | null
        }
        Relationships: []
      }
      cma_sources: {
        Row: {
          asof: string
          asset_class: string
          exact: boolean
          house: string
          value: number | null
        }
        Insert: {
          asof: string
          asset_class: string
          exact?: boolean
          house: string
          value?: number | null
        }
        Update: {
          asof?: string
          asset_class?: string
          exact?: boolean
          house?: string
          value?: number | null
        }
        Relationships: []
      }
      cpi_cache: {
        Row: {
          asof_month: string
          index_value: number | null
          series: string
        }
        Insert: {
          asof_month: string
          index_value?: number | null
          series: string
        }
        Update: {
          asof_month?: string
          index_value?: number | null
          series?: string
        }
        Relationships: []
      }
      estate_docs: {
        Row: {
          created_at: string
          doc_type: string | null
          file_ref: string | null
          id: string
          last_reviewed: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          doc_type?: string | null
          file_ref?: string | null
          id?: string
          last_reviewed?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          doc_type?: string | null
          file_ref?: string | null
          id?: string
          last_reviewed?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      etf_holdings: {
        Row: {
          asof: string | null
          etf_symbol: string
          holding_name: string | null
          holding_symbol: string
          weight: number | null
        }
        Insert: {
          asof?: string | null
          etf_symbol: string
          holding_name?: string | null
          holding_symbol: string
          weight?: number | null
        }
        Update: {
          asof?: string | null
          etf_symbol?: string
          holding_name?: string | null
          holding_symbol?: string
          weight?: number | null
        }
        Relationships: []
      }
      holdings: {
        Row: {
          account_id: string | null
          cost_basis: number | null
          created_at: string
          entry_mode: string
          id: string
          kind: string
          manual_amount: number | null
          name: string | null
          proj_growth: number | null
          shares: number | null
          symbol: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          cost_basis?: number | null
          created_at?: string
          entry_mode: string
          id?: string
          kind: string
          manual_amount?: number | null
          name?: string | null
          proj_growth?: number | null
          shares?: number | null
          symbol?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          cost_basis?: number | null
          created_at?: string
          entry_mode?: string
          id?: string
          kind?: string
          manual_amount?: number | null
          name?: string | null
          proj_growth?: number | null
          shares?: number | null
          symbol?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "holdings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      infl_expectations_cache: {
        Row: {
          asof: string
          horizon_years: number
          source: string
          value: number | null
        }
        Insert: {
          asof: string
          horizon_years: number
          source: string
          value?: number | null
        }
        Update: {
          asof?: string
          horizon_years?: number
          source?: string
          value?: number | null
        }
        Relationships: []
      }
      insurance_policies: {
        Row: {
          beneficiary: string | null
          carrier: string | null
          coverage: number | null
          created_at: string
          id: string
          kind: string | null
          owner: string | null
          premium: number | null
          user_id: string
        }
        Insert: {
          beneficiary?: string | null
          carrier?: string | null
          coverage?: number | null
          created_at?: string
          id?: string
          kind?: string | null
          owner?: string | null
          premium?: number | null
          user_id: string
        }
        Update: {
          beneficiary?: string | null
          carrier?: string | null
          coverage?: number | null
          created_at?: string
          id?: string
          kind?: string | null
          owner?: string | null
          premium?: number | null
          user_id?: string
        }
        Relationships: []
      }
      liabilities: {
        Row: {
          created_at: string
          id: string
          kind: string
          label: string | null
          orig_balance: number
          property_id: string | null
          rate: number | null
          start_date: string | null
          term_months: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          label?: string | null
          orig_balance: number
          property_id?: string | null
          rate?: number | null
          start_date?: string | null
          term_months?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          orig_balance?: number
          property_id?: string | null
          rate?: number | null
          start_date?: string | null
          term_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "liabilities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "real_estate"
            referencedColumns: ["id"]
          },
        ]
      }
      net_worth_snapshots: {
        Row: {
          asof_date: string
          by_class: Json
          total: number | null
          user_id: string
        }
        Insert: {
          asof_date: string
          by_class?: Json
          total?: number | null
          user_id: string
        }
        Update: {
          asof_date?: string
          by_class?: Json
          total?: number | null
          user_id?: string
        }
        Relationships: []
      }
      nowcast_cache: {
        Row: {
          asof_day: string
          index: string
          value: number | null
        }
        Insert: {
          asof_day: string
          index: string
          value?: number | null
        }
        Update: {
          asof_day?: string
          index?: string
          value?: number | null
        }
        Relationships: []
      }
      phase_plan: {
        Row: {
          confidence_target: number | null
          downshift_age: number | null
          legacy_target: number | null
          lifestyle_by_phase: Json
          maintain_mode: boolean
          phase2_income_frac: number | null
          phase2_years: number | null
          retire_age: number | null
          updated_at: string
          user_id: string
          withdrawal_guardrails: Json
        }
        Insert: {
          confidence_target?: number | null
          downshift_age?: number | null
          legacy_target?: number | null
          lifestyle_by_phase?: Json
          maintain_mode?: boolean
          phase2_income_frac?: number | null
          phase2_years?: number | null
          retire_age?: number | null
          updated_at?: string
          user_id: string
          withdrawal_guardrails?: Json
        }
        Update: {
          confidence_target?: number | null
          downshift_age?: number | null
          legacy_target?: number | null
          lifestyle_by_phase?: Json
          maintain_mode?: boolean
          phase2_income_frac?: number | null
          phase2_years?: number | null
          retire_age?: number | null
          updated_at?: string
          user_id?: string
          withdrawal_guardrails?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          dob: string | null
          filing_status: string | null
          plan_to_age: number | null
          retire_age: number | null
          share_with: string[]
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dob?: string | null
          filing_status?: string | null
          plan_to_age?: number | null
          retire_age?: number | null
          share_with?: string[]
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dob?: string | null
          filing_status?: string | null
          plan_to_age?: number | null
          retire_age?: number | null
          share_with?: string[]
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quote_cache: {
        Row: {
          prev_close: number | null
          price: number | null
          symbol: string
          updated_at: string
        }
        Insert: {
          prev_close?: number | null
          price?: number | null
          symbol: string
          updated_at?: string
        }
        Update: {
          prev_close?: number | null
          price?: number | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      real_estate: {
        Row: {
          as_of: string | null
          created_at: string
          id: string
          kind: string
          label: string | null
          market_value: number
          updated_at: string
          user_id: string
          value_source: string
        }
        Insert: {
          as_of?: string | null
          created_at?: string
          id?: string
          kind: string
          label?: string | null
          market_value: number
          updated_at?: string
          user_id: string
          value_source?: string
        }
        Update: {
          as_of?: string | null
          created_at?: string
          id?: string
          kind?: string
          label?: string | null
          market_value?: number
          updated_at?: string
          user_id?: string
          value_source?: string
        }
        Relationships: []
      }
      rebalance_bands: {
        Row: {
          abs_pts: number | null
          asset_class: string
          rel_pct: number | null
          user_id: string
        }
        Insert: {
          abs_pts?: number | null
          asset_class: string
          rel_pct?: number | null
          user_id: string
        }
        Update: {
          abs_pts?: number | null
          asset_class?: string
          rel_pct?: number | null
          user_id?: string
        }
        Relationships: []
      }
      scenarios: {
        Row: {
          created_at: string
          id: string
          is_base: boolean
          name: string
          params: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_base?: boolean
          name: string
          params?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_base?: boolean
          name?: string
          params?: Json
          user_id?: string
        }
        Relationships: []
      }
      spending_baseline: {
        Row: {
          annual_amount: number | null
          by_category: Json
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          annual_amount?: number | null
          by_category?: Json
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          annual_amount?: number | null
          by_category?: Json
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      statement_imports: {
        Row: {
          candidates: Json
          created_at: string
          error: string | null
          file_name: string | null
          file_path: string
          id: string
          status: string
          summary: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          candidates?: Json
          created_at?: string
          error?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          status?: string
          summary?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          candidates?: Json
          created_at?: string
          error?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          status?: string
          summary?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tax_parameters: {
        Row: {
          params: Json
          tax_year: number
          updated_at: string
          user_id: string
        }
        Insert: {
          params: Json
          tax_year: number
          updated_at?: string
          user_id: string
        }
        Update: {
          params?: Json
          tax_year?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      target_allocation: {
        Row: {
          asset_class: string
          glide: Json | null
          target_pct: number | null
          user_id: string
        }
        Insert: {
          asset_class: string
          glide?: Json | null
          target_pct?: number | null
          user_id: string
        }
        Update: {
          asset_class?: string
          glide?: Json | null
          target_pct?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
