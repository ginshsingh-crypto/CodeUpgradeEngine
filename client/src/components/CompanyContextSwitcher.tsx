
import { useCompany } from "@/lib/companyContext";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Building2, User } from "lucide-react";

export function CompanyContextSwitcher() {
    const { selectedCompanyId, setSelectedCompanyId, companies } = useCompany();

    return (
        <Select
            value={selectedCompanyId || "personal"}
            onValueChange={(val) => setSelectedCompanyId(val === "personal" ? null : val)}
        >
            <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select Account" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="personal">
                    <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        <span>Personal Account</span>
                    </div>
                </SelectItem>
                {companies.map((company: any) => (
                    <SelectItem key={company.id} value={company.id}>
                        <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            <span>{company.name}</span>
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
