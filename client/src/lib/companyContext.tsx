
import React, { createContext, useContext, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface CompanyContextType {
    selectedCompanyId: string | null; // null = personal
    setSelectedCompanyId: (id: string | null) => void;
    selectedCompany: any | null; // The full company object if selected
    isLoading: boolean;
    companies: any[];
    personalBalance: number;
    currentBalance: number;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() => {
        // Persist in localStorage
        return localStorage.getItem("selectedCompanyId") || null;
    });

    const { data: balanceData, isLoading } = useQuery({
        queryKey: ["/api/balance"],
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    const companies = balanceData?.companies || [];

    // Validate selectedCompanyId exists in companies (if not null)
    const selectedCompany = companies.find((c: any) => c.id === selectedCompanyId) || null;

    useEffect(() => {
        if (selectedCompanyId) {
            localStorage.setItem("selectedCompanyId", selectedCompanyId);
        } else {
            localStorage.removeItem("selectedCompanyId");
        }
    }, [selectedCompanyId]);

    return (
        selectedCompany,
        isLoading,
        companies,
        personalBalance: balanceData?.personal || 0,
            // Helper to get currently active balance (personal or company)
            currentBalance: selectedCompany ? selectedCompany.balanceSar : (balanceData?.personal || 0),
            }}
        >
    { children }
        </CompanyContext.Provider >
    );
}

export function useCompany() {
    const context = useContext(CompanyContext);
    if (context === undefined) {
        throw new Error("useCompany must be used within a CompanyProvider");
    }
    return context;
}
